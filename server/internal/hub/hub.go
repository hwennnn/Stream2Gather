// Package hub connects browsers to rooms. It holds no authority: every change
// goes through Redis, so any server can handle any viewer.
package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"

	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
)

const (
	maxMessageBytes = 8 << 10
	maxChatRunes    = 500
	sendBuffer      = 128
	writeTimeout    = 5 * time.Second
	eventBuffer     = 1024
	touchEvery      = 10 * time.Second
	snapshotEvery   = 5 * time.Second
	// A room with viewers saves this often even if nothing changes. Saving is what
	// extends its life, and a paused room full of chat must not expire under people.
	keepAliveEvery = time.Hour
	opTimeout      = 5 * time.Second
	versionTimeout = time.Second
	// Chrome runs a hidden tab's timers once a minute, so a healthy viewer can
	// go that long between pings. Anything shorter drops people who tabbed away.
	idleTimeout = 90 * time.Second
	// A host who reloads or loses signal for a moment keeps their lock.
	hostGrace = 30 * time.Second
	// An empty room keeps running briefly, so a reload resumes seamlessly.
	emptyGraceMS = 60_000
	// MaxSocketsPerUser is per person, per room, across every server.
	MaxSocketsPerUser = 10
	// How many distinct people must report an embed block before it is believed.
	embedBlockReports = 2
)

// Hub tracks the rooms active on this server.
type Hub struct {
	db      *store.Postgres
	live    *store.Live
	catalog *source.Catalog
	log     *slog.Logger
	pubsub  *redis.PubSub
	// recorder hears about activity. It never blocks and may lose events.
	recorder Recorder

	// Timings are fields so tests need not wait them out.
	idleTimeout time.Duration
	hostGrace   time.Duration
	touchEvery  time.Duration
	snapshots   time.Duration
	keepAlive   time.Duration

	// mu is held across Redis subscribes, which keeps them in order. Delivery
	// must never wait for that, so it reads active instead of rooms.
	mu      sync.Mutex
	rooms   map[string]*liveRoom
	active  sync.Map // room id to *liveRoom
	closing bool
	serving sync.WaitGroup
}

// New returns a hub. Call Run to start delivering events.
func New(db *store.Postgres, live *store.Live, rdb *redis.Client, catalog *source.Catalog, log *slog.Logger) *Hub {
	h := &Hub{
		db:      db,
		live:    live,
		catalog: catalog,
		log:     log,
		pubsub:  rdb.Subscribe(context.Background()),

		idleTimeout: idleTimeout,
		hostGrace:   hostGrace,
		touchEvery:  touchEvery,
		snapshots:   snapshotEvery,
		keepAlive:   keepAliveEvery,

		rooms: make(map[string]*liveRoom),
	}
	h.recorder = newRecorder(h)
	return h
}

// Run delivers Redis events to local rooms until ctx ends. One connection
// carries every room on this server, so nothing here may ever wait for a room.
func (h *Hub) Run(ctx context.Context) {
	go h.recorder.Run(ctx)
	messages := h.pubsub.ChannelWithSubscriptions(redis.WithChannelSize(eventBuffer))
	for {
		select {
		case <-ctx.Done():
			_ = h.pubsub.Close()
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			switch event := message.(type) {
			case *redis.Message:
				if r := h.roomOn(event.Channel); r != nil {
					r.enqueue([]byte(event.Payload))
				}
			case *redis.Subscription:
				// The client resubscribes by itself after losing Redis, and
				// whatever was published meanwhile is gone.
				if r := h.roomOn(event.Channel); r != nil && event.Kind == "subscribe" && r.subscribed.Swap(true) {
					r.requestResync()
				}
			}
		}
	}
}

func (h *Hub) roomOn(channel string) *liveRoom {
	roomID := strings.TrimSuffix(strings.TrimPrefix(channel, "room:"), ":events")
	if r, ok := h.active.Load(roomID); ok {
		return r.(*liveRoom)
	}
	return nil
}

var errClosing = errors.New("server is shutting down")

func (h *Hub) acquire(ctx context.Context, roomID string) (*liveRoom, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closing {
		return nil, errClosing
	}
	if r, ok := h.rooms[roomID]; ok {
		r.refs++
		h.serving.Add(1)
		return r, nil
	}
	r := &liveRoom{
		id:     roomID,
		hub:    h,
		refs:   1,
		in:     make(chan func(), 256),
		events: make(chan []byte, eventBuffer),
		resync: make(chan struct{}, 1),
		saves:  make(chan struct{}, 1),
		done:   make(chan struct{}),
		conns:  make(map[*conn]struct{}),
	}
	// Visible before subscribing, so the confirmation has a room to land on.
	h.active.Store(roomID, r)
	if err := h.pubsub.Subscribe(ctx, store.Channel(roomID)); err != nil {
		h.active.Delete(roomID)
		return nil, err
	}
	h.rooms[roomID] = r
	h.serving.Add(2)
	go r.run()
	go r.saver()
	return r, nil
}

func (h *Hub) release(r *liveRoom) {
	h.mu.Lock()
	defer h.mu.Unlock()
	defer h.serving.Done()

	r.refs--
	if r.refs > 0 {
		return
	}
	delete(h.rooms, r.id)
	h.active.Delete(r.id)
	close(r.done)
	if h.closing {
		return // The subscription goes with the process.
	}
	// Unsubscribing under the lock stops it landing after a new viewer has
	// subscribed the same room again, which would leave them deaf.
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	if err := h.pubsub.Unsubscribe(ctx, store.Channel(r.id)); err != nil {
		h.log.Warn("unsubscribe failed", "room", r.id, "error", err)
	}
}

// Close disconnects everyone with a code that tells browsers to reconnect, and
// returns once each room has saved its state and every leave has run, or ctx ends.
func (h *Hub) Close(ctx context.Context) error {
	h.mu.Lock()
	h.closing = true
	rooms := make([]*liveRoom, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()

	finished := make(chan struct{})
	go func() {
		defer close(finished)
		var saving sync.WaitGroup
		for _, r := range rooms {
			saving.Go(func() { r.wait(r.shutDown) })
		}
		saving.Wait()
		h.serving.Wait()
	}()
	select {
	case <-finished:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *Hub) isClosing() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.closing
}

// Message is the wire envelope.
type Message struct {
	Type string          `json:"t"`
	ID   string          `json:"id,omitempty"`
	Data json.RawMessage `json:"d,omitempty"`
}

func encode(kind string, data any) []byte {
	body, err := json.Marshal(struct {
		Type string `json:"t"`
		Data any    `json:"d"`
	}{kind, data})
	if err != nil {
		panic(err) // Only our own plain structs reach this.
	}
	return body
}

// stateMessage carries what changed, with attribution for the UI. Queue has no
// omitempty: an empty queue is news, and only playback events leave it out.
type stateMessage struct {
	Version  int64          `json:"version"`
	Playback room.Playback  `json:"playback"`
	Queue    []room.Item    `json:"queue"`
	Settings *room.Settings `json:"settings,omitempty"`
	Cause    string         `json:"cause"`
	By       string         `json:"by,omitempty"`
}

type playbackMessage struct {
	Version  int64         `json:"version"`
	Playback room.Playback `json:"playback"`
	Cause    string        `json:"cause"`
	By       string        `json:"by,omitempty"`
}

func encodeChange(state room.State, change room.Change) []byte {
	if !change.Queue && !change.Settings {
		return encode("playback", playbackMessage{
			Version: state.Version, Playback: state.Playback, Cause: change.Cause, By: change.By,
		})
	}
	queue := state.Queue
	if queue == nil {
		queue = []room.Item{}
	}
	return encode("state", stateMessage{
		Version: state.Version, Playback: state.Playback, Queue: queue, Settings: &state.Settings,
		Cause: change.Cause, By: change.By,
	})
}

// encodeSnapshot tells a client to take this state whatever it holds now.
func encodeSnapshot(state room.State) []byte {
	return encodeChange(state, room.Change{Cause: causeSync, Queue: true, Settings: true})
}

const causeSync = "sync"

// conn is one browser tab.
type conn struct {
	id      string
	address string
	out     chan []byte
	closed  chan struct{}
	once    sync.Once
	code    websocket.StatusCode
	reason  string
	control *rate.Limiter
	chat    *rate.Limiter
	// reactions has its own limit, so a burst of them can't cost a chat message.
	reactions *rate.Limiter
	reports   *rate.Limiter
	// voiceRate has its own limit, so push-to-talk can't cost a pause.
	voiceRate *rate.Limiter

	mu     sync.RWMutex
	person store.Person
}

func (c *conn) who() store.Person {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.person
}

func (c *conn) rename(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.person.Name = name
}

// shut asks the write loop to close the socket with this code.
func (c *conn) shut(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		c.code, c.reason = code, reason
		close(c.closed)
	})
}

func (c *conn) close() { c.shut(websocket.StatusPolicyViolation, "too slow") }

// send never blocks a room: a viewer who cannot keep up is disconnected, and
// reconnecting gives them a fresh snapshot.
func (c *conn) send(message []byte) {
	select {
	case c.out <- message:
	case <-c.closed:
	default:
		c.close()
	}
}

func (c *conn) fail(id, code, text string) {
	c.send(encode("error", map[string]string{"re": id, "code": code, "message": text}))
}

// ack answers a request. Messages sent without an id expect no answer.
func (c *conn) ack(id string) {
	if id != "" {
		c.send(encode("ack", map[string]string{"id": id}))
	}
}

// liveRoom serialises one room's work on this server through a single goroutine.
type liveRoom struct {
	id   string
	hub  *Hub
	refs int
	in   chan func()
	// events has its own queue, because Hub.Run can only ever offer, not wait.
	events chan []byte
	resync chan struct{}
	done   chan struct{}
	conns  map[*conn]struct{}
	// dirty means Redis holds something Postgres does not.
	dirty atomic.Bool
	saves chan struct{}
	// savedAt is when this server last asked for a save. Zero means not yet.
	savedAt time.Time
	// subscribed turns true on Redis's first confirmation. Any later one means
	// the subscription was lost and restored.
	subscribed atomic.Bool
}

func (r *liveRoom) do(work func()) {
	select {
	case r.in <- work:
	case <-r.done:
	}
}

// wait is do, returning once the work has finished.
func (r *liveRoom) wait(work func()) {
	finished := make(chan struct{})
	r.do(func() {
		defer close(finished)
		work()
	})
	select {
	case <-finished:
	case <-r.done:
	}
}

// enqueue hands over an event without waiting. A room too far behind to take it
// loses the event and is resynced once it catches up.
func (r *liveRoom) enqueue(payload []byte) {
	select {
	case r.events <- payload:
	default:
		r.requestResync()
	}
}

func (r *liveRoom) requestResync() {
	select {
	case r.resync <- struct{}{}:
	default:
	}
}

func (r *liveRoom) run() {
	touch := time.NewTicker(r.hub.touchEvery)
	defer touch.Stop()
	snapshot := time.NewTicker(r.hub.snapshots)
	defer snapshot.Stop()

	for {
		select {
		case <-r.done:
			return
		case payload := <-r.events:
			r.deliver(payload)
		case <-r.resync:
			r.broadcastSnapshot()
		case work := <-r.in:
			work()
		case <-touch.C:
			r.touchAll()
		case <-snapshot.C:
			if len(r.conns) > 0 && time.Since(r.savedAt) >= r.hub.keepAlive {
				r.dirty.Store(true)
			}
			r.saveSnapshot()
		}
	}
}

func opContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), opTimeout)
}

func (r *liveRoom) deliver(payload []byte) {
	var head struct {
		Type string `json:"t"`
		Data struct {
			Version int64  `json:"version"`
			UserID  string `json:"userId"`
			Name    string `json:"name"`
		} `json:"d"`
	}
	if err := json.Unmarshal(payload, &head); err == nil {
		if head.Data.Version > 0 {
			r.dirty.Store(true)
		}
		if head.Type == "member.rename" {
			r.renamed(head.Data.UserID, head.Data.Name)
		}
	}
	for c := range r.conns {
		c.send(payload)
	}
}

// renamed refreshes this person's local tabs, wherever the rename came from.
func (r *liveRoom) renamed(userID, name string) {
	ctx, cancel := opContext()
	defer cancel()
	changed := false
	for c := range r.conns {
		if c.who().UserID != userID {
			continue
		}
		c.rename(name)
		changed = true
		if err := r.hub.live.Touch(ctx, r.id, c.id, c.who()); err != nil {
			r.hub.log.Warn("presence write failed", "room", r.id, "error", err)
		}
	}
	if changed {
		r.publishMembers(ctx)
	}
}

// broadcastSnapshot repairs viewers after events were lost on the way here.
func (r *liveRoom) broadcastSnapshot() {
	ctx, cancel := opContext()
	defer cancel()
	state, err := r.ensureState(ctx)
	if err != nil {
		r.hub.log.Warn("resync failed", "room", r.id, "error", err)
		return
	}
	snapshot := encodeSnapshot(state)
	for c := range r.conns {
		c.send(snapshot)
	}
	// Whatever took the events may have taken presence as well.
	r.touchAll()
	r.publishMembers(ctx)
}

func (r *liveRoom) touchAll() {
	ctx, cancel := opContext()
	defer cancel()
	for c := range r.conns {
		if err := r.hub.live.Touch(ctx, r.id, c.id, c.who()); err != nil {
			r.hub.log.Warn("presence refresh failed", "room", r.id, "error", err)
		}
	}
	pruned, err := r.hub.live.Prune(ctx, r.id)
	if err != nil {
		r.hub.log.Warn("presence prune failed", "room", r.id, "error", err)
	}
	if pruned > 0 {
		r.publishMembers(ctx)
	}
	r.settleHost(ctx)
}

// settleHost opens a locked room when its host has been gone a while, and locks
// it again when they return. The clock lives in Redis and the decision goes
// through compare-and-set, so any server can run this and only one announces it.
func (r *liveRoom) settleHost(ctx context.Context) {
	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		return
	}
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found {
		return
	}
	now := time.Now().UnixMilli()

	if i := slices.IndexFunc(people, func(p store.Person) bool { return p.Role == room.RoleHost }); i >= 0 {
		host := people[i]
		if err := r.hub.live.HostSeen(ctx, r.id, host.Name, now); err != nil {
			r.hub.log.Warn("host presence failed", "room", r.id, "error", err)
		}
		if state.Held != nil && r.applySystem(ctx, room.Command{Type: room.CmdRestore}) {
			r.publishNotice(ctx, map[string]string{"kind": "host", "text": host.Name + " is back, so they control playback again."})
		}
		return
	}
	if state.Held != nil || !state.Settings.Locked() {
		return
	}
	name, seen, err := r.hub.live.HostLastSeen(ctx, r.id, now)
	if err != nil || now-seen < r.hub.hostGrace.Milliseconds() {
		return
	}
	if name == "" {
		name = "The host"
	}
	if r.applySystem(ctx, room.Command{Type: room.CmdRelease}) {
		r.publishNotice(ctx, map[string]string{"kind": "host", "text": name + " left, so anyone can control playback."})
	}
}

func (r *liveRoom) publishNotice(ctx context.Context, notice map[string]string) {
	if err := r.hub.live.Publish(ctx, r.id, encode("notice", notice)); err != nil {
		r.hub.log.Warn("notice publish failed", "room", r.id, "error", err)
	}
}

// shutDown saves the room and starts closing its sockets. Each one's leave then
// runs as its connection unwinds.
func (r *liveRoom) shutDown() {
	r.dirty.Store(true)
	r.saveSnapshot()
	for c := range r.conns {
		c.shut(websocket.StatusGoingAway, "server restarting")
	}
}

// saveSnapshot asks for a save. The room's goroutine delivers every event, so it
// must never wait on Postgres: a slow database would stop playback for everyone.
func (r *liveRoom) saveSnapshot() {
	if !r.dirty.Swap(false) {
		return
	}
	r.savedAt = time.Now()
	select {
	case r.saves <- struct{}{}:
	default: // One is already waiting, and it will read the latest state.
	}
}

// saver does the saving. The room can finish first, so it takes one last look.
func (r *liveRoom) saver() {
	defer r.hub.serving.Done()
	for {
		select {
		case <-r.saves:
			r.save()
		case <-r.done:
			select {
			case <-r.saves:
				r.save()
			default:
			}
			return
		}
	}
}

func (r *liveRoom) save() {
	ctx, cancel := opContext()
	defer cancel()
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err == nil && found {
		err = r.hub.db.SaveSnapshot(ctx, r.id, state)
	}
	if err != nil {
		r.hub.log.Warn("snapshot failed", "room", r.id, "error", err)
		r.dirty.Store(true)
	}
}

func (r *liveRoom) publishMembers(ctx context.Context) {
	people, err := r.hub.live.People(ctx, r.id)
	if err == nil {
		err = r.hub.live.Publish(ctx, r.id, encode("members", map[string]any{"members": people}))
	}
	if err != nil {
		r.hub.log.Warn("members publish failed", "room", r.id, "error", err)
	}
}

// ensureState restores a room Redis has forgotten. With nobody here it waits,
// paused where it was; with people watching it carries on under them. The saved
// version is older than what viewers hold, so it jumps past anything they can
// have seen, and a snapshot goes out to pull them onto it.
func (r *liveRoom) ensureState(ctx context.Context) (room.State, error) {
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || found {
		return state, err
	}
	state, savedAt, err := r.hub.db.LoadSnapshot(ctx, r.id)
	if err != nil {
		return room.State{}, err
	}
	now := time.Now().UnixMilli()
	state.Version = max(state.Version+1, now)
	if len(r.conns) == 0 {
		state = state.Rested(savedAt.UnixMilli(), now)
	}
	if err := r.hub.live.Seed(ctx, r.id, state); err != nil {
		return room.State{}, err
	}
	// Another server may have got there first, and its state is the one that counts.
	state, found, err = r.hub.live.Load(ctx, r.id)
	if err != nil {
		return room.State{}, err
	}
	if !found {
		return room.State{}, store.ErrNoState
	}
	if err := r.hub.live.Publish(ctx, r.id, encodeSnapshot(state)); err != nil {
		r.hub.log.Warn("snapshot publish failed", "room", r.id, "error", err)
	}
	return state, nil
}

// settleEmptyRoom pauses a room that nobody has watched for a while, at the
// point the last viewer left, instead of letting it run on without them.
func (r *liveRoom) settleEmptyRoom(ctx context.Context) {
	emptiedAt, err := r.hub.live.TakeEmpty(ctx, r.id)
	// Redis can stall long enough for viewers still here to look gone.
	if err != nil || emptiedAt == 0 || len(r.conns) > 0 {
		return
	}
	now := time.Now().UnixMilli()
	if now-emptiedAt < emptyGraceMS {
		return
	}
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found || state.Playback.Status != room.StatusPlaying {
		return
	}
	r.applySystem(ctx, room.Command{
		Type: room.CmdPause,
		Item: state.Playback.ItemID,
		Pos:  state.PositionAt(emptiedAt),
		CT:   now,
	})
}

// applySystem reports whether the command took effect, so that of several
// servers deciding the same thing only the winner announces it.
func (r *liveRoom) applySystem(ctx context.Context, cmd room.Command) bool {
	_, err := r.mutate(ctx, room.Actor{System: true}, cmd)
	if err != nil && !errors.Is(err, room.ErrStale) {
		r.hub.log.Warn("system command failed", "room", r.id, "command", cmd.Type, "error", err)
	}
	return err == nil
}

// mutate rehydrates and tries once more if Redis has lost the room, so viewers
// who are still connected never find out.
func (r *liveRoom) mutate(ctx context.Context, actor room.Actor, cmd room.Command) (room.State, error) {
	var change room.Change
	attempt := func() (room.State, error) {
		return r.hub.live.Mutate(ctx, r.id,
			func(state room.State) (room.State, error) {
				next, applied, err := room.Apply(state, actor, cmd, time.Now().UnixMilli())
				change = applied
				return next, err
			},
			func(state room.State) ([]byte, error) { return encodeChange(state, change), nil },
		)
	}
	state, err := attempt()
	if errors.Is(err, store.ErrNoState) {
		if _, err := r.ensureState(ctx); err != nil {
			return room.State{}, err
		}
		state, err = attempt()
	}
	if err == nil {
		r.hub.recorder.Applied(r.id, state)
	}
	return state, err
}

func (r *liveRoom) join(c *conn, ticket store.Ticket) {
	if r.hub.isClosing() {
		c.shut(websocket.StatusGoingAway, "server restarting")
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	person := c.who()

	// A crash leaves its connections behind with nothing to clear them. Nobody
	// here means nothing else will, and they would count against this viewer.
	if _, err := r.hub.live.Prune(ctx, r.id); err != nil {
		r.hub.log.Warn("presence prune failed", "room", r.id, "error", err)
	}

	// The ticket checks this too. This is the check that races can't get past,
	// and the reconnect it causes gets the reason from the ticket.
	if open, err := r.hub.live.Sockets(ctx, r.id, person.UserID); err == nil && open >= MaxSocketsPerUser {
		c.shut(websocket.StatusPolicyViolation, "too many connections")
		return
	}

	// Tickets are checked before anyone joins, so a crowd holding them all at once
	// gets past that. The reconnect this causes is what shows the reason.
	if r.full(ctx, person, ticket.MaxMembers) {
		c.shut(websocket.StatusPolicyViolation, "room full")
		return
	}

	state, err := r.ensureState(ctx)
	if err != nil {
		r.hub.log.Error("join failed", "room", r.id, "error", err)
		c.fail("", "unavailable", "This room could not be opened.")
		c.close()
		return
	}
	r.settleEmptyRoom(ctx)
	if latest, found, err := r.hub.live.Load(ctx, r.id); err == nil && found {
		state = latest
	}

	if err := r.hub.live.Touch(ctx, r.id, c.id, person); err != nil {
		r.hub.log.Warn("presence write failed", "room", r.id, "error", err)
	}
	r.conns[c] = struct{}{}
	r.hub.recorder.Joined(r.id, person)

	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		r.hub.log.Warn("presence read failed", "room", r.id, "error", err)
	}
	c.send(encode("welcome", map[string]any{
		"self":    person,
		"room":    map[string]string{"id": r.id, "slug": ticket.RoomSlug, "name": ticket.RoomName},
		"state":   state,
		"members": people,
	}))
	r.publishMembers(ctx)
	r.settleHost(ctx)
}

// full reports whether this person would take the room past its cap. The owner
// and anyone already here are never over it, and Redis failing refuses nobody.
func (r *liveRoom) full(ctx context.Context, person store.Person, limit int) bool {
	if limit <= 0 || person.Role == room.RoleHost {
		return false
	}
	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		return false
	}
	here := slices.ContainsFunc(people, func(p store.Person) bool { return p.UserID == person.UserID })
	return !here && len(people) >= limit
}

func (r *liveRoom) leave(c *conn) {
	ctx, cancel := opContext()
	defer cancel()

	if _, joined := r.conns[c]; !joined {
		return
	}
	delete(r.conns, c)
	if err := r.hub.live.Leave(ctx, r.id, c.id); err != nil {
		r.hub.log.Warn("presence removal failed", "room", r.id, "error", err)
	}
	r.publishMembers(ctx)

	person := c.who()
	if person.Role == room.RoleHost {
		// The grace period counts from now, not from the last presence refresh.
		if err := r.hub.live.HostSeen(ctx, r.id, person.Name, time.Now().UnixMilli()); err != nil {
			r.hub.log.Warn("host presence failed", "room", r.id, "error", err)
		}
	}

	people, err := r.hub.live.People(ctx, r.id)
	if err == nil && !slices.ContainsFunc(people, func(p store.Person) bool { return p.UserID == person.UserID }) {
		r.hub.recorder.Left(r.id, person.UserID)
	}
	if err == nil && len(people) == 0 {
		if err := r.hub.live.MarkEmpty(ctx, r.id, time.Now().UnixMilli()); err != nil {
			r.hub.log.Warn("empty mark failed", "room", r.id, "error", err)
		}
		r.dirty.Store(true)
		r.saveSnapshot()
	}
}
