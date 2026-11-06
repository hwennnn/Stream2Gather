package hub

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
)

// Serve runs one connection until it closes.
func (h *Hub) Serve(ctx context.Context, ws *websocket.Conn, ticket store.Ticket) {
	ws.SetReadLimit(maxMessageBytes)

	r, err := h.acquire(ctx, ticket.RoomID)
	if err != nil {
		h.log.Error("room subscribe failed", "room", ticket.RoomID, "error", err)
		_ = ws.Close(websocket.StatusInternalError, "unavailable")
		return
	}
	defer h.release(r)

	c := &conn{
		id:      ids.New(),
		person:  ticket.Person,
		out:     make(chan []byte, sendBuffer),
		closed:  make(chan struct{}),
		control: rate.NewLimiter(5, 10),
		chat:    rate.NewLimiter(2, 5),
	}
	defer c.close()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go writeLoop(ctx, ws, c, cancel)

	r.do(func() { r.join(c, ticket) })
	defer r.do(func() { r.leave(c) })

	for {
		_, payload, err := ws.Read(ctx)
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

func writeLoop(ctx context.Context, ws *websocket.Conn, c *conn, cancel context.CancelFunc) {
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			_ = ws.Close(websocket.StatusPolicyViolation, "too slow")
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
		r.pong(c, message)
	case "queue.add":
		r.queueAdd(ctx, c, message)
	case "chat.send":
		r.chat(c, message)
	case "react":
		r.react(c, message)
	case "status":
		r.status(c, message)
	case "media_error":
		r.mediaError(c, message)
	case room.CmdPlay, room.CmdPause, room.CmdSeek, room.CmdRate, room.CmdEnded, room.CmdSkip,
		room.CmdQueueRemove, room.CmdQueueMove, room.CmdQueuePlay, room.CmdQueueClear, room.CmdSettings:
		r.command(c, message)
	default:
		c.fail(message.ID, "unknown", "Unknown message.")
	}
}

func (r *liveRoom) pong(c *conn, message Message) {
	var ping struct {
		T0 float64 `json:"t0"`
	}
	_ = json.Unmarshal(message.Data, &ping)
	c.send(encode("pong", map[string]any{
		"t0":      ping.T0,
		"ts":      time.Now().UnixMilli(),
		"version": r.version.Load(),
	}))
}

func actorOf(c *conn) room.Actor {
	return room.Actor{ID: c.person.UserID, Name: c.person.Name, Role: c.person.Role}
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
	r.do(func() { r.applyFor(c, message.ID, cmd) })
}

func (r *liveRoom) applyFor(c *conn, id string, cmd room.Command) {
	ctx, cancel := opContext()
	defer cancel()

	_, err := r.mutate(ctx, actorOf(c), cmd)
	switch {
	case err == nil:
		if id != "" {
			c.send(encode("ack", map[string]string{"id": id}))
		}
	case errors.Is(err, room.ErrStale):
		// The sender acted on an old view. A snapshot corrects it quietly.
		r.sendSnapshot(ctx, c)
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
	c.send(encodeChange(state, room.Change{Cause: "sync", Queue: true, Settings: true}))
}

func (r *liveRoom) queueAdd(ctx context.Context, c *conn, message Message) {
	if !c.control.Allow() {
		c.fail(message.ID, "rate_limited", "Slow down a little.")
		return
	}
	var request struct {
		URL     string `json:"url"`
		PlayNow bool   `json:"playNow"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil {
		c.fail(message.ID, "bad_message", "That message could not be read.")
		return
	}

	// Metadata always comes from the source, never from the client.
	media, err := r.hub.catalog.Resolve(ctx, request.URL)
	if err != nil {
		if source.IsUserError(err) {
			c.fail(message.ID, "media", err.Error())
			return
		}
		r.hub.log.Error("resolve failed", "room", r.id, "error", err)
		c.fail(message.ID, "media", "That video could not be loaded. Try again.")
		return
	}

	cmd := room.Command{Type: room.CmdQueueAdd, PlayNow: request.PlayNow, Media: &media, NewItemID: ids.New()}
	r.do(func() { r.applyFor(c, message.ID, cmd) })
}

func (r *liveRoom) chat(c *conn, message Message) {
	if !c.chat.Allow() {
		c.fail(message.ID, "rate_limited", "Slow down a little.")
		return
	}
	var request struct {
		Text  string `json:"text"`
		Nonce string `json:"nonce"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil {
		c.fail(message.ID, "bad_message", "That message could not be read.")
		return
	}
	text := strings.TrimSpace(request.Text)
	if text == "" || utf8.RuneCountInString(text) > maxChatRunes {
		c.fail(message.ID, "invalid", "Messages can be up to 500 characters.")
		return
	}

	ctx, cancel := opContext()
	defer cancel()
	stored, err := r.hub.db.InsertMessage(ctx, r.id, store.Message{
		UserID: c.person.UserID, Author: c.person.Name, Body: text,
	})
	if err == nil {
		err = r.hub.live.Publish(ctx, r.id, encode("chat", map[string]any{
			"message": stored, "nonce": request.Nonce,
		}))
	}
	if err != nil {
		r.hub.log.Error("chat failed", "room", r.id, "error", err)
		c.fail(message.ID, "unavailable", "Your message did not send.")
	}
}

var reactions = map[string]bool{"😂": true, "❤️": true, "🔥": true, "😮": true, "👏": true, "😭": true}

func (r *liveRoom) react(c *conn, message Message) {
	var request struct {
		Emoji string `json:"emoji"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil || !reactions[request.Emoji] || !c.chat.Allow() {
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	_ = r.hub.live.Publish(ctx, r.id, encode("react", map[string]string{
		"emoji": request.Emoji, "name": c.person.Name,
	}))
}

// status shares a viewer's sync health. Clients send it when it changes.
func (r *liveRoom) status(c *conn, message Message) {
	var request struct {
		State string  `json:"state"`
		Drift float64 `json:"drift"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil || !c.control.Allow() {
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	_ = r.hub.live.Publish(ctx, r.id, encode("member.status", map[string]any{
		"userId": c.person.UserID, "state": request.State, "drift": request.Drift,
	}))
}

// YouTube player errors that mean the owner forbids embedded playback.
var embedRefused = map[int]bool{101: true, 150: true}

// mediaError keeps a video one viewer cannot play from breaking the room. Once
// most viewers fail, the room moves on and the video is remembered as blocked.
func (r *liveRoom) mediaError(c *conn, message Message) {
	var report struct {
		Item string `json:"item"`
		Code int    `json:"code"`
	}
	if err := json.Unmarshal(message.Data, &report); err != nil {
		return
	}

	ctx, cancel := opContext()
	defer cancel()
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found || state.Playback.ItemID != report.Item || len(state.Queue) == 0 {
		return
	}
	failures, err := r.hub.live.CountFailure(ctx, r.id, report.Item, c.person.UserID)
	if err != nil {
		return
	}
	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		return
	}
	_ = r.hub.live.Publish(ctx, r.id, encode("member.status", map[string]any{
		"userId": c.person.UserID, "state": "unavailable",
	}))
	if failures*2 <= int64(len(people)) {
		return
	}

	item := state.Queue[0]
	if embedRefused[report.Code] {
		if err := r.hub.db.MarkEmbedBlocked(ctx, item.Source, item.SourceID); err != nil {
			r.hub.log.Warn("embed block not saved", "error", err)
		}
	}
	r.do(func() {
		skipCtx, done := opContext()
		defer done()
		r.applySystem(skipCtx, room.Command{Type: room.CmdSkip, Item: report.Item})
		_ = r.hub.live.Publish(skipCtx, r.id, encode("notice", map[string]string{
			"kind": "skipped",
			"text": "Skipped “" + item.Title + "”. Its owner doesn’t allow it to play outside YouTube.",
			"url":  item.URL,
		}))
	})
}
