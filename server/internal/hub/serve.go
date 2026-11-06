package hub

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"

	"stream2gather/internal/config"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
)

// PageOnIP reports whether a socket came from a page whose address is an IP. The
// browser sets Origin, so it can be trusted more than anything the page says.
func PageOnIP(r *http.Request) bool {
	return config.IPOrigin(r.Header.Get("Origin"))
}

// Serve runs one connection until it closes.
func (h *Hub) Serve(ctx context.Context, ws *websocket.Conn, ticket store.Ticket) {
	ws.SetReadLimit(maxMessageBytes)

	if !h.admit(ticket.Address) {
		_ = ws.Close(websocket.StatusPolicyViolation, "too many connections")
		return
	}
	defer h.dismiss(ticket.Address)

	r, err := h.acquire(ctx, ticket.RoomID)
	if errors.Is(err, errClosing) {
		_ = ws.Close(websocket.StatusGoingAway, "server restarting")
		return
	}
	if err != nil {
		h.log.Error("room subscribe failed", "room", ticket.RoomID, "error", err)
		_ = ws.Close(websocket.StatusInternalError, "unavailable")
		return
	}
	defer h.release(r)

	c := &conn{
		id:      ids.New(),
		address: ticket.Address,
		version: ticket.SessionVersion,
		ipPage:  ticket.IPPage,
		person:  ticket.Person,
		out:     make(chan []byte, sendBuffer),
		closed:  make(chan struct{}),
		limits:  r.limitsFor(ticket.Person.UserID),
		pings:   rate.NewLimiter(2, 10),
	}
	defer c.close()
	if ticket.Account {
		h.accounts.Store(c, r.id)
		defer h.accounts.Delete(c)
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go writeLoop(ctx, ws, c, cancel)
	go keepAlive(ctx, ws, h.pingEvery, cancel)

	// Reading starts only after the welcome is queued. A pong that overtakes it
	// tells the client it is behind a room it has not been shown yet.
	r.wait(func() { r.join(c, ticket) })
	// This has to finish before release can close the room, or the last viewer's
	// presence and empty mark are lost with it.
	defer r.wait(func() { r.leave(c, false) })

	for {
		payload, err := readMessage(ctx, ws, h.idleTimeout)
		if err != nil {
			return
		}
		var message Message
		if err := json.Unmarshal(payload, &message); err != nil {
			c.fail("", "bad_message", "That message could not be read.")
			continue
		}
		r.handle(ctx, c, message)
	}
}

// readMessage gives up on a peer that has gone silent. Clients ping every three
// seconds, so this only fires on a connection that died without saying so.
func readMessage(ctx context.Context, ws *websocket.Conn, idle time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, idle)
	defer cancel()
	_, payload, err := ws.Read(ctx)
	return payload, err
}

// admit counts a socket against its address, or refuses it. A socket with no
// address is one the server made for itself.
func (h *Hub) admit(address string) bool {
	if address == "" {
		return true
	}
	h.addressMu.Lock()
	defer h.addressMu.Unlock()
	if h.addresses[address] >= h.maxPerAddress {
		return false
	}
	h.addresses[address]++
	return true
}

func (h *Hub) dismiss(address string) {
	if address == "" {
		return
	}
	h.addressMu.Lock()
	defer h.addressMu.Unlock()
	if h.addresses[address]--; h.addresses[address] <= 0 {
		delete(h.addresses, address)
	}
}

// keepAlive ends a connection whose peer no longer answers at all. A ping waits
// up to one interval for its reply, and the read loop is what receives it.
func keepAlive(ctx context.Context, ws *websocket.Conn, every time.Duration, cancel context.CancelFunc) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			waiting, done := context.WithTimeout(ctx, every)
			err := ws.Ping(waiting)
			done()
			if err != nil {
				cancel()
				return
			}
		}
	}
}

func writeLoop(ctx context.Context, ws *websocket.Conn, c *conn, cancel context.CancelFunc) {
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			_ = ws.Close(c.code, c.reason)
			return
		case message := <-c.out:
			writeCtx, done := context.WithTimeout(ctx, writeTimeout)
			err := ws.Write(writeCtx, websocket.MessageText, message)
			done()
			if err != nil {
				return
			}
		}
	}
}

// handle runs on the connection's goroutine. Slow work stays here; only the
// final room change goes through the room's loop.
func (r *liveRoom) handle(ctx context.Context, c *conn, message Message) {
	switch message.Type {
	case "ping":
		r.pong(ctx, c, message)
	case "leave":
		r.wait(func() { r.leave(c, true) })
		c.shut(websocket.StatusNormalClosure, "left")
	case "sync":
		r.syncClient(c)
	case "rename":
		r.rename(c, message)
	case "queue.add":
		r.queueAdd(ctx, c, message)
	case "chat.send":
		r.chat(c, message)
	case "react":
		r.react(c, message)
	case "status":
		r.status(c, message)
	case "voice":
		r.voice(c, message)
	case "media_error":
		r.mediaError(c, message)
	case "media_ok":
		r.mediaOK(c, message)
	case room.CmdPlay, room.CmdPause, room.CmdSeek, room.CmdEnded, room.CmdSkip,
		room.CmdQueueRemove, room.CmdQueueMove, room.CmdQueuePlay, room.CmdQueueUndo, room.CmdSettings:
		r.command(c, message)
	default:
		c.fail(message.ID, "unknown", "Unknown message.")
	}
}

// pong reports the version in Redis, not the last one seen here. Comparing the
// room with itself could never reveal that this server missed an event.
func (r *liveRoom) pong(ctx context.Context, c *conn, message Message) {
	if !c.pings.Allow() {
		return
	}
	var ping struct {
		T0 float64 `json:"t0"`
	}
	_ = json.Unmarshal(message.Data, &ping)
	reply := map[string]any{"t0": ping.T0, "ts": time.Now().UnixMilli()}

	ctx, cancel := context.WithTimeout(ctx, versionTimeout)
	defer cancel()
	if version, found, err := r.hub.live.Version(ctx, r.id); err == nil && found {
		reply["version"] = version
	}
	c.send(encode("pong", reply))
}

// syncClient answers a client that noticed a gap in the versions it was sent.
func (r *liveRoom) syncClient(c *conn) {
	if !c.control.Allow() {
		return
	}
	r.do(func() {
		ctx, cancel := opContext()
		defer cancel()
		r.sendSnapshot(ctx, c)
	})
}

func (r *liveRoom) rename(c *conn, message Message) {
	if !c.control.Allow() {
		c.fail(message.ID, "rate_limited", "Slow down a little.")
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil {
		c.fail(message.ID, "bad_message", "That message could not be read.")
		return
	}
	name, ok := room.CleanName(request.Name)
	if !ok {
		c.fail(message.ID, "invalid", "Names can be up to 32 characters.")
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	// Going through Redis reaches this person's tabs on other servers too.
	err := r.hub.live.Publish(ctx, r.id, encode("member.rename", map[string]string{
		"userId": c.who().UserID, "name": name,
	}))
	if err != nil {
		r.hub.log.Error("rename failed", "room", r.id, "error", err)
		c.fail(message.ID, "unavailable", "That did not go through. Try again.")
		return
	}
	c.ack(message.ID)
}

func actorOf(c *conn) room.Actor {
	person := c.who()
	return room.Actor{ID: person.UserID, Name: person.Name, Role: person.Role}
}

func (r *liveRoom) command(c *conn, message Message) {
	if !c.control.Allow() {
		c.fail(message.ID, "rate_limited", "Slow down a little.")
		return
	}
	var cmd room.Command
	if len(message.Data) > 0 {
		if err := json.Unmarshal(message.Data, &cmd); err != nil {
			c.fail(message.ID, "bad_message", "That message could not be read.")
			return
		}
	}
	cmd.Type = message.Type
	r.queueFor(c, message.ID, cmd)
}

// queueFor hands a command to the room. Its time starts now, not when the room
// gets to it: after a stall, a pause from half a minute ago must not land on
// viewers who have long since moved on.
func (r *liveRoom) queueFor(c *conn, id string, cmd room.Command) {
	deadline := time.Now().Add(r.hub.commandPatience)
	r.do(func() { r.applyFor(c, id, cmd, deadline) })
}

func (r *liveRoom) applyFor(c *conn, id string, cmd room.Command, deadline time.Time) {
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()

	_, err := r.mutate(ctx, actorOf(c), cmd)
	switch {
	case err == nil:
		c.ack(id)
	case errors.Is(err, room.ErrStale):
		// The sender acted on an old view. A snapshot corrects it quietly, but
		// someone waiting on an answer still has to get one.
		if id != "" {
			c.fail(id, "stale", "That changed before it went through. Try again.")
		}
		r.sendSnapshot(ctx, c)
	case errors.Is(err, room.ErrForbidden) && cmd.Type == room.CmdEnded:
		// Every viewer's player reports the end. Nobody asked to do anything.
	case errors.Is(err, room.ErrForbidden):
		c.fail(id, "forbidden", "The host controls this room.")
		r.sendSnapshot(ctx, c)
	case errors.Is(err, room.ErrQueueFull):
		c.fail(id, "queue_full", "The queue is full.")
	case errors.Is(err, room.ErrInvalid):
		c.fail(id, "invalid", "That action is not valid.")
	default:
		r.hub.log.Error("command failed", "room", r.id, "command", cmd.Type, "error", err)
		c.fail(id, "unavailable", "That did not go through. Try again.")
	}
}

func (r *liveRoom) sendSnapshot(ctx context.Context, c *conn) {
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found {
		return
	}
	c.send(encodeSnapshot(state))
}

func (r *liveRoom) queueAdd(ctx context.Context, c *conn, message Message) {
	if !c.control.Allow() {
		c.fail(message.ID, "rate_limited", "Slow down a little.")
		return
	}
	var request struct {
		URL  string `json:"url"`
		Mode string `json:"mode"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil {
		c.fail(message.ID, "bad_message", "That message could not be read.")
		return
	}

	// A lookup can take seconds, and this goroutine is the one reading the socket.
	// Pings left unanswered that long look like a dead connection to the client.
	go r.addResolved(ctx, c, message.ID, request.URL, request.Mode)
}

func (r *liveRoom) addResolved(ctx context.Context, c *conn, id, link, mode string) {
	// Metadata always comes from the source, never from the client.
	media, err := r.hub.catalog.Resolve(ctx, link, source.LookupCharge(r.hub.live.Limit, c.address))
	if err != nil {
		if source.IsUserError(err) {
			c.fail(id, "media", err.Error())
			return
		}
		r.hub.log.Error("resolve failed", "room", r.id, "error", err)
		c.fail(id, "media", "That video could not be loaded. Try again.")
		return
	}

	cmd := room.Command{Type: room.CmdQueueAdd, Mode: mode, Media: &media, NewItemID: ids.New()}
	r.queueFor(c, id, cmd)
}

func (r *liveRoom) chat(c *conn, message Message) {
	if !c.chat.Allow() {
		c.fail(message.ID, "rate_limited", "Slow down a little.")
		return
	}
	var request struct {
		Text     string `json:"text"`
		ClientID string `json:"clientId"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil {
		c.fail(message.ID, "bad_message", "That message could not be read.")
		return
	}
	text, ok := room.CleanChat(request.Text)
	if !ok || len(request.ClientID) > maxClientIDBytes {
		c.fail(message.ID, "invalid", "That message could not be read.")
		return
	}
	if utf8.RuneCountInString(text) > maxChatRunes {
		c.fail(message.ID, "invalid", "Messages can be up to 500 characters.")
		return
	}

	ctx, cancel := opContext()
	defer cancel()
	person := c.who()
	stored, fresh, err := r.hub.db.SaveMessage(ctx, r.id, store.Message{
		UserID: person.UserID, Author: person.Name, Body: text, ClientID: request.ClientID,
	})
	if err == nil && fresh {
		r.hub.recorder.Moment(r.id, Moment{
			Kind: MomentChat, UserID: person.UserID, Author: person.Name, MessageID: stored.ID, At: stored.CreatedAt,
		})
	}
	// A repeat is published too: the first attempt may have failed right here.
	// Viewers drop a line they already have.
	if err == nil {
		err = r.hub.live.Publish(ctx, r.id, encode("chat", map[string]any{"message": stored}))
	}
	if err != nil {
		r.hub.log.Error("chat failed", "room", r.id, "error", err)
		c.fail(message.ID, "unavailable", "Your message did not send.")
		return
	}
	c.ack(message.ID)
}

var reactions = map[string]bool{"😂": true, "❤️": true, "🔥": true, "😮": true, "👏": true, "😭": true}

func (r *liveRoom) react(c *conn, message Message) {
	var request struct {
		Emoji string `json:"emoji"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil || !reactions[request.Emoji] || !c.reactions.Allow() {
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	person := c.who()
	err := r.hub.live.Publish(ctx, r.id, encode("react", map[string]string{
		"emoji": request.Emoji, "name": person.Name, "userId": person.UserID,
	}))
	if err == nil {
		r.hub.recorder.Moment(r.id, Moment{
			Kind: MomentReaction, UserID: person.UserID, Author: person.Name, Emoji: request.Emoji, At: time.Now(),
		})
	}
}

// viewerStates are the only states relayed. Other clients use them as keys.
var viewerStates = map[string]bool{
	"waiting": true, "synced": true, "correcting": true, "buffering": true, "stalled": true,
}

// status shares a viewer's sync health. Clients send it when it changes.
func (r *liveRoom) status(c *conn, message Message) {
	var request struct {
		State string  `json:"state"`
		Drift float64 `json:"drift"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil || !viewerStates[request.State] || !c.status.Allow() {
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	_ = r.hub.live.Publish(ctx, r.id, encode("member.status", map[string]any{
		"userId": c.who().UserID, "state": request.State, "drift": request.Drift,
	}))
}

// YouTube player errors that mean the owner forbids embedded playback.
var embedRefused = map[int]bool{101: true, 150: true}

// mediaError keeps a video one viewer cannot play from breaking the room. Once
// most viewers fail, the room moves on. A report costs nothing to send, so one
// never decides anything for other rooms: see noteEmbedBlock.
func (r *liveRoom) mediaError(c *conn, message Message) {
	var report struct {
		Item string `json:"item"`
		Kind string `json:"kind"`
		Code int    `json:"code"`
	}
	if err := json.Unmarshal(message.Data, &report); err != nil || !c.reports.Allow() {
		return
	}

	ctx, cancel := opContext()
	defer cancel()
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found || state.Playback.ItemID != report.Item || len(state.Queue) == 0 {
		return
	}
	item := state.Queue[0]
	userID := c.who().UserID
	refused := item.Source == "youtube" && embedRefused[report.Code]
	r.hub.log.Info("player error", "room", r.id, "source", item.Source, "video", item.SourceID, "code", report.Code)
	_ = r.hub.live.Publish(ctx, r.id, encode("member.status", map[string]any{
		"userId": userID, "state": "unavailable", "item": report.Item,
	}))
	// The refusal was about this page, so it decides nothing for anyone else.
	if refused && c.ipPage {
		return
	}
	if refused {
		r.noteEmbedBlock(ctx, item, userID)
	}

	if err := r.hub.live.AddFailure(ctx, r.id, report.Item, userID); err != nil {
		return
	}
	failing, err := r.hub.live.Failing(ctx, r.id, report.Item)
	if err != nil {
		return
	}
	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		return
	}
	if !mostAreFailing(people, failing) {
		return
	}

	why := wontLoad
	if refused {
		why = youTubeRefused
	} else if item.Source == "direct" && report.Kind == "embed_blocked" {
		why = streamRefused
	}
	notice := skippedNotice(item, why)
	r.do(func() {
		skipCtx, done := opContext()
		defer done()
		// Everyone's player fails together, and only one skip wins.
		if r.applySystem(skipCtx, room.Command{Type: room.CmdSkip, Item: report.Item}) {
			r.publishNotice(skipCtx, notice)
		}
	})
}

// The reasons a video was skipped, finishing the sentence in skippedNotice.
const (
	wontLoad       = "it wouldn’t load"
	youTubeRefused = "YouTube won’t let it play here"
	streamRefused  = "this stream doesn’t allow playback here"
)

func skippedNotice(item room.Item, why string) map[string]string {
	notice := map[string]string{"kind": "skipped", "text": "Skipped “" + item.Title + "” because " + why + "."}
	if item.Source == "youtube" {
		notice["url"] = item.URL
	}
	return notice
}

// mediaOK clears a refusal once anyone's player shows the video. A refusal can be
// local to some viewers, and a wrong mark only costs the video its place in search.
func (r *liveRoom) mediaOK(c *conn, message Message) {
	var report struct {
		Item string `json:"item"`
	}
	if err := json.Unmarshal(message.Data, &report); err != nil || !c.reports.Allow() {
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found || state.Playback.ItemID != report.Item || len(state.Queue) == 0 {
		return
	}
	item := state.Queue[0]
	if err := r.hub.live.ForgetEmbedReports(ctx, item.Source, item.SourceID); err != nil {
		r.hub.log.Warn("embed reports not cleared", "error", err)
	}
	if err := r.hub.db.ClearEmbedBlock(ctx, item.Source, item.SourceID); err != nil {
		r.hub.log.Warn("embed block not cleared", "error", err)
	}
}

// noteEmbedBlock marks a video in everyone's search only once more than one
// person has seen it refused. Any guest could otherwise blacklist it site-wide.
func (r *liveRoom) noteEmbedBlock(ctx context.Context, item room.Item, userID string) {
	reports, err := r.hub.live.ReportEmbedBlocked(ctx, item.Source, item.SourceID, userID)
	if err != nil {
		r.hub.log.Warn("embed report not saved", "error", err)
		return
	}
	if reports < embedBlockReports {
		return
	}
	if err := r.hub.db.MarkEmbedBlocked(ctx, item.Source, item.SourceID); err != nil {
		r.hub.log.Warn("embed block not saved", "error", err)
	}
}
