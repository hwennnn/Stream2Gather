// Package hub connects browsers to rooms. It holds no authority: every change
// goes through Redis, so any server can handle any viewer.
package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

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
	touchEvery      = 10 * time.Second
	snapshotEvery   = 5 * time.Second
	opTimeout       = 5 * time.Second
	// An empty room keeps running briefly, so a reload resumes seamlessly.
	emptyGraceMS = 60_000
)

// Hub tracks the rooms active on this server.
type Hub struct {
	db      *store.Postgres
	live    *store.Live
	catalog *source.Catalog
	log     *slog.Logger
	pubsub  *redis.PubSub

	mu    sync.Mutex
	rooms map[string]*liveRoom
}

// New returns a hub. Call Run to start delivering events.
func New(db *store.Postgres, live *store.Live, rdb *redis.Client, catalog *source.Catalog, log *slog.Logger) *Hub {
	return &Hub{
		db:      db,
		live:    live,
		catalog: catalog,
		log:     log,
		pubsub:  rdb.Subscribe(context.Background()),
		rooms:   make(map[string]*liveRoom),
	}
}

// Run delivers Redis events to local rooms until ctx ends. One connection
// carries every room on this server.
func (h *Hub) Run(ctx context.Context) {
	messages := h.pubsub.Channel(redis.WithChannelSize(1024))
	for {
		select {
		case <-ctx.Done():
			_ = h.pubsub.Close()
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			roomID := strings.TrimSuffix(strings.TrimPrefix(message.Channel, "room:"), ":events")
			h.mu.Lock()
			r := h.rooms[roomID]
			h.mu.Unlock()
			if r != nil {
				payload := []byte(message.Payload)
				r.do(func() { r.deliver(payload) })
			}
		}
	}
}

func (h *Hub) acquire(ctx context.Context, roomID string) (*liveRoom, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if r, ok := h.rooms[roomID]; ok {
		r.refs++
		return r, nil
	}
	if err := h.pubsub.Subscribe(ctx, store.Channel(roomID)); err != nil {
		return nil, err
	}
	r := &liveRoom{
		id:    roomID,
		hub:   h,
		refs:  1,
		in:    make(chan func(), 256),
		done:  make(chan struct{}),
		conns: make(map[*conn]struct{}),
	}
	h.rooms[roomID] = r
	go r.run()
	return r, nil
}

func (h *Hub) release(r *liveRoom) {
	h.mu.Lock()
	r.refs--
	last := r.refs == 0
	if last {
		delete(h.rooms, r.id)
	}
	h.mu.Unlock()

	if last {
		ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
		defer cancel()
		if err := h.pubsub.Unsubscribe(ctx, store.Channel(r.id)); err != nil {
			h.log.Warn("unsubscribe failed", "room", r.id, "error", err)
		}
		close(r.done)
	}
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

// stateMessage carries what changed, with attribution for the UI.
type stateMessage struct {
	Version  int64          `json:"version"`
	Playback room.Playback  `json:"playback"`
	Queue    []room.Item    `json:"queue,omitempty"`
	Settings *room.Settings `json:"settings,omitempty"`
	Cause    string         `json:"cause"`
	By       string         `json:"by,omitempty"`
}

func encodeChange(state room.State, change room.Change) []byte {
	message := stateMessage{Version: state.Version, Playback: state.Playback, Cause: change.Cause, By: change.By}
	if !change.Queue && !change.Settings {
		return encode("playback", message)
	}
	message.Queue = state.Queue
	if message.Queue == nil {
		message.Queue = []room.Item{}
	}
	message.Settings = &state.Settings
	return encode("state", message)
}

// conn is one browser tab.
type conn struct {
	id      string
	person  store.Person
	out     chan []byte
	closed  chan struct{}
	once    sync.Once
	control *rate.Limiter
	chat    *rate.Limiter
}

func (c *conn) close() { c.once.Do(func() { close(c.closed) }) }

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

// liveRoom serialises one room's work on this server through a single goroutine.
type liveRoom struct {
	id      string
	hub     *Hub
	refs    int
	in      chan func()
	done    chan struct{}
	conns   map[*conn]struct{}
	dirty   bool
	version atomic.Int64
}

func (r *liveRoom) do(work func()) {
	select {
	case r.in <- work:
	case <-r.done:
	}
}

func (r *liveRoom) run() {
	touch := time.NewTicker(touchEvery)
	defer touch.Stop()
	snapshot := time.NewTicker(snapshotEvery)
	defer snapshot.Stop()

	for {
		select {
		case <-r.done:
			return
		case work := <-r.in:
			work()
		case <-touch.C:
			r.touchAll()
		case <-snapshot.C:
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
			Version int64 `json:"version"`
		} `json:"d"`
	}
	if err := json.Unmarshal(payload, &head); err == nil && head.Data.Version > 0 {
		r.version.Store(head.Data.Version)
		r.dirty = true
	}
	for c := range r.conns {
		c.send(payload)
	}
}

func (r *liveRoom) touchAll() {
	ctx, cancel := opContext()
	defer cancel()
	for c := range r.conns {
		if err := r.hub.live.Touch(ctx, r.id, c.id, c.person); err != nil {
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
}

func (r *liveRoom) saveSnapshot() {
	if !r.dirty {
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err == nil && found {
		err = r.hub.db.SaveSnapshot(ctx, r.id, state)
	}
	if err != nil {
		r.hub.log.Warn("snapshot failed", "room", r.id, "error", err)
		return
	}
	r.dirty = false
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

// ensureState restores a room Redis has forgotten, paused where it was.
func (r *liveRoom) ensureState(ctx context.Context) (room.State, error) {
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || found {
		return state, err
	}
	state, err = r.hub.db.LoadSnapshot(ctx, r.id)
	if err != nil {
		return room.State{}, err
	}
	if state.Playback.Status == room.StatusPlaying {
		now := time.Now().UnixMilli()
		state.Playback.Pos = state.Playback.Position(now)
		state.Playback.At = now
		state.Playback.Status = room.StatusPaused
	}
	if err := r.hub.live.Seed(ctx, r.id, state); err != nil {
		return room.State{}, err
	}
	return state, nil
}

// settleEmptyRoom pauses a room that nobody has watched for a while, at the
// point the last viewer left, instead of letting it run on without them.
func (r *liveRoom) settleEmptyRoom(ctx context.Context) {
	emptiedAt, err := r.hub.live.TakeEmpty(ctx, r.id)
	if err != nil || emptiedAt == 0 {
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
		Pos:  state.Playback.Position(emptiedAt),
		CT:   now,
	})
}

func (r *liveRoom) applySystem(ctx context.Context, cmd room.Command) {
	_, err := r.mutate(ctx, room.Actor{System: true}, cmd)
	if err != nil && !errors.Is(err, room.ErrStale) {
		r.hub.log.Warn("system command failed", "room", r.id, "command", cmd.Type, "error", err)
	}
}

func (r *liveRoom) mutate(ctx context.Context, actor room.Actor, cmd room.Command) (room.State, error) {
	var change room.Change
	return r.hub.live.Mutate(ctx, r.id,
		func(state room.State) (room.State, error) {
			next, applied, err := room.Apply(state, actor, cmd, time.Now().UnixMilli())
			change = applied
			return next, err
		},
		func(state room.State) ([]byte, error) { return encodeChange(state, change), nil },
	)
}

func (r *liveRoom) join(c *conn, ticket store.Ticket) {
	ctx, cancel := opContext()
	defer cancel()

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
	r.version.Store(state.Version)

	if err := r.hub.live.Touch(ctx, r.id, c.id, c.person); err != nil {
		r.hub.log.Warn("presence write failed", "room", r.id, "error", err)
	}
	r.conns[c] = struct{}{}

	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		r.hub.log.Warn("presence read failed", "room", r.id, "error", err)
	}
	c.send(encode("welcome", map[string]any{
		"self":       c.person,
		"room":       map[string]string{"id": r.id, "slug": ticket.RoomSlug, "name": ticket.RoomName},
		"state":      state,
		"members":    people,
		"serverTime": time.Now().UnixMilli(),
	}))
	r.publishMembers(ctx)
}

func (r *liveRoom) leave(c *conn) {
	ctx, cancel := opContext()
	defer cancel()

	delete(r.conns, c)
	if err := r.hub.live.Leave(ctx, r.id, c.id); err != nil {
		r.hub.log.Warn("presence removal failed", "room", r.id, "error", err)
	}
	r.publishMembers(ctx)

	people, err := r.hub.live.People(ctx, r.id)
	if err == nil && len(people) == 0 {
		if err := r.hub.live.MarkEmpty(ctx, r.id, time.Now().UnixMilli()); err != nil {
			r.hub.log.Warn("empty mark failed", "room", r.id, "error", err)
		}
		r.dirty = true
		r.saveSnapshot()
	}
}
