// Package hub connects browsers to rooms. It holds no authority: every change
// goes through Redis, so any server can handle any viewer.
package hub

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
)

const (
	maxMessageBytes = 8 << 10
	maxChatRunes    = 500
	// maxClientIDBytes is plenty for a random id, and keeps the index small.
	maxClientIDBytes = 64
	sendBuffer       = 128
	writeTimeout     = 5 * time.Second
	eventBuffer      = 1024
	touchEvery       = 10 * time.Second
	snapshotEvery    = 5 * time.Second
	// A room with viewers saves this often even if nothing changes. Saving is what
	// extends its life, and a paused room full of chat must not expire under people.
	keepAliveEvery = time.Hour
	opTimeout      = 5 * time.Second
	versionTimeout = time.Second
	// Chrome runs a hidden tab's timers once a minute, so a healthy viewer can
	// go that long between pings. Anything shorter drops people who tabbed away.
	idleTimeout = 90 * time.Second
	// The browser itself answers these, whatever a hidden tab's timers are doing,
	// so someone whose machine slept is gone in seconds rather than idleTimeout.
	pingEvery = 15 * time.Second
	// A host who reloads or loses signal for a moment stays the host. One who
	// says they're leaving doesn't get this.
	hostGrace = 30 * time.Second
	// A reload shows as leaving and joining, and within this it shows as nothing.
	rejoinQuiet = 10 * time.Second
	// An empty room keeps running briefly, so a reload resumes seamlessly.
	emptyGraceMS = 60_000
	// sessionCheckEvery bounds how long a signed-out socket stays open.
	sessionCheckEvery = 10 * time.Second
	// statusSignedOut closes a socket whose session has ended. Reconnecting then
	// finds out who the cookie is now, if anyone.
	statusSignedOut = websocket.StatusCode(4401)
	// MaxSocketsPerUser is per person, per room, across every server.
	MaxSocketsPerUser = 10
	// maxSocketsPerAddress is per server. It is four full rooms behind one
	// address, because guests are free and the per-person limit stops nobody
	// who makes more of them.
	maxSocketsPerAddress = 200
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
	idleTimeout     time.Duration
	hostGrace       time.Duration
	rejoinQuiet     time.Duration
	touchEvery      time.Duration
	snapshots       time.Duration
	keepAlive       time.Duration
	sessionCheck    time.Duration
	pingEvery       time.Duration
	commandPatience time.Duration

	// mu is held across Redis subscribes, which keeps them in order. Delivery
	// must never wait for that, so it reads active instead of rooms.
	mu     sync.Mutex
	rooms  map[string]*liveRoom
	active sync.Map // room id to *liveRoom
	// accounts holds every signed-in *conn and its room's id. It sits apart from
	// the rooms so that checking them needs nothing from a room's goroutine.
	accounts sync.Map
	// LeaveCall takes someone out of a room's voice call, which outlives their
	// socket because tokens can't be revoked. Nil means no voice. Set it before Run.
	LeaveCall func(ctx context.Context, roomID, userID string) error
	// leavers is who still has to leave a call. The session check clears it.
	leaversMu sync.Mutex
	leavers   map[seat]struct{}
	// addresses counts open sockets per address, on this server.
	addressMu     sync.Mutex
	addresses     map[string]int
	maxPerAddress int

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

		idleTimeout:     idleTimeout,
		hostGrace:       hostGrace,
		rejoinQuiet:     rejoinQuiet,
		touchEvery:      touchEvery,
		snapshots:       snapshotEvery,
		keepAlive:       keepAliveEvery,
		sessionCheck:    sessionCheckEvery,
		leavers:         map[seat]struct{}{},
		pingEvery:       pingEvery,
		commandPatience: opTimeout,

		rooms:         make(map[string]*liveRoom),
		addresses:     make(map[string]int),
		maxPerAddress: maxSocketsPerAddress,
	}
	h.recorder = newRecorder(h)
	return h
}

// Run delivers Redis events to local rooms until ctx ends. One connection
// carries every room on this server, so nothing here may ever wait for a room.
func (h *Hub) Run(ctx context.Context) {
	go h.recorder.Run(ctx)
	go h.watchSessions(ctx)
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

// watchSessions ends sockets whose session has been signed out. The check is on a
// timer rather than an event so that it cannot be missed, whatever was down at
// the moment of sign-out, and one query covers every signed-in viewer here.
func (h *Hub) watchSessions(ctx context.Context) {
	ticker := time.NewTicker(h.sessionCheck)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.endSignedOut(ctx)
		}
	}
}

func (h *Hub) endSignedOut(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, opTimeout)
	defer cancel()
	h.closeSignedOut(ctx)
	h.clearCalls(ctx)
}

// seat is one person in one room.
type seat struct{ room, user string }

func (h *Hub) closeSignedOut(ctx context.Context) {
	conns := map[*conn]string{}
	var ids []string
	h.accounts.Range(func(key, roomID any) bool {
		c := key.(*conn)
		conns[c] = roomID.(string)
		ids = append(ids, c.who().UserID)
		return true
	})
	if len(ids) == 0 {
		return
	}
	versions, err := h.db.SessionVersions(ctx, ids)
	if err != nil {
		// Not knowing is no reason to drop a party. The next check will tell.
		h.log.Warn("session check failed", "error", err)
		return
	}
	staying := map[seat]bool{}
	for c, roomID := range conns {
		here := seat{roomID, c.who().UserID}
		if version, found := versions[here.user]; !found || version != c.version {
			c.shut(statusSignedOut, "signed out")
			h.owesCall(here)
		} else {
			staying[here] = true
		}
	}
	// A call belongs to the person, so one who signed back in keeps it.
	h.leaversMu.Lock()
	defer h.leaversMu.Unlock()
	for here := range staying {
		delete(h.leavers, here)
	}
}

// owesCall notes that someone must leave a call, for the next session check.
func (h *Hub) owesCall(here seat) {
	h.leaversMu.Lock()
	defer h.leaversMu.Unlock()
	h.leavers[here] = struct{}{}
}

// clearCalls runs after the sockets close, so a slow voice server delays nobody's
// disconnect. A removal that fails waits for the next check: nothing else would
// try again once the socket has gone.
func (h *Hub) clearCalls(ctx context.Context) {
	h.leaversMu.Lock()
	owed := slices.Collect(maps.Keys(h.leavers))
	h.leaversMu.Unlock()
	for _, here := range owed {
		if h.LeaveCall != nil {
			if err := h.LeaveCall(ctx, here.room, here.user); err != nil {
				h.log.Warn("removing someone from a call failed", "room", here.room, "error", err)
				continue
			}
		}
		h.leaversMu.Lock()
		delete(h.leavers, here)
		h.leaversMu.Unlock()
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

// stateMessage carries what changed, with attribution for the UI. Queue is the
// whole queue, for a client taking a snapshot. omitzero keeps an empty one, which
// is news. Everyone else gets Patch, or neither if the queue didn't change.
type stateMessage struct {
	Version  int64          `json:"version"`
	Playback room.Playback  `json:"playback"`
	Queue    []room.Item    `json:"queue,omitzero"`
	Patch    *queuePatch    `json:"patch,omitempty"`
	Settings *room.Settings `json:"settings,omitempty"`
	Cause    string         `json:"cause"`
	By       string         `json:"by,omitempty"`
}

// queuePatch turns the queue at the version before this one into this one:
// replace Remove items at At with IDs. Items holds any of those a client can't
// already have. Every viewer gets every change, so one full queue per change was
// the largest thing the server sent. Size lets a client notice it had a different
// queue, and ask for a snapshot.
type queuePatch struct {
	At     int         `json:"at"`
	Remove int         `json:"remove"`
	IDs    []string    `json:"ids"`
	Items  []room.Item `json:"items,omitempty"`
	Size   int         `json:"size"`
}

// diffQueue finds the one stretch that differs. Items are compared whole, so an
// item that changed under its id is sent again.
func diffQueue(before, after []room.Item) *queuePatch {
	start := 0
	for start < len(before) && start < len(after) && before[start] == after[start] {
		start++
	}
	end := 0
	for end < len(before)-start && end < len(after)-start && before[len(before)-1-end] == after[len(after)-1-end] {
		end++
	}
	patch := &queuePatch{At: start, Remove: len(before) - start - end, IDs: []string{}, Size: len(after)}
	for _, item := range after[start : len(after)-end] {
		patch.IDs = append(patch.IDs, item.ID)
		if !slices.Contains(before, item) {
			patch.Items = append(patch.Items, item)
		}
	}
	return patch
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

// encodeApplied is encodeChange for one step from a known queue, sending only
// what that step changed. A client that missed a step notices by its version.
func encodeApplied(before []room.Item, state room.State, change room.Change) []byte {
	if !change.Queue && !change.Settings {
		return encodeChange(state, change)
	}
	message := stateMessage{Version: state.Version, Playback: state.Playback, Cause: change.Cause, By: change.By}
	if change.Queue {
		message.Patch = diffQueue(before, state.Queue)
	}
	if change.Settings {
		message.Settings = &state.Settings
	}
	return encode("state", message)
}

// encodeSnapshot tells a client to take this state whatever it holds now.
func encodeSnapshot(state room.State) []byte {
	return encodeChange(state, room.Change{Cause: causeSync, Queue: true, Settings: true})
}

const causeSync = "sync"

// limits belong to a person, not a tab, so that neither opening more tabs nor
// reconnecting buys more of them.
type limits struct {
	control *rate.Limiter
	chat    *rate.Limiter
	// reactions has its own limit, so a burst of them can't cost a chat message.
	reactions *rate.Limiter
	// status has its own too, so a flapping player can't cost a pause.
	status  *rate.Limiter
	reports *rate.Limiter
	// voiceRate has its own limit, so push-to-talk can't cost a pause.
	voiceRate *rate.Limiter
}

func newLimits() *limits {
	return &limits{
		control:   rate.NewLimiter(5, 10),
		chat:      rate.NewLimiter(2, 5),
		reactions: rate.NewLimiter(2, 5),
		status:    rate.NewLimiter(2, 5),
		reports:   rate.NewLimiter(rate.Every(5*time.Second), 3),
		voiceRate: rate.NewLimiter(5, 10),
	}
}

// conn is one browser tab.
type conn struct {
	id      string
	address string
	// version is the session version of a signed-in person.
	version int64
	out     chan []byte
	closed  chan struct{}
	once    sync.Once
	code    websocket.StatusCode
	reason  string
	*limits
	// pings is per tab, because each tab has its own clock to keep.
	pings *rate.Limiter
	// ipPage says the viewer's page has an IP address, where YouTube refuses videos
	// that are fine, so a refusal says nothing about the video.
	ipPage bool

	mu     sync.RWMutex
	person store.Person
}

func (c *conn) who() store.Person {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.person
}

func (c *conn) arrive(at int64) store.Person {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.person.Since = at
	return c.person
}

func (c *conn) rename(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.person.Name = name
}

func (c *conn) setRole(role string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.person.Role = role
}

func (c *conn) setMember(member bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.person.Member = member
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
	// people outlives any one connection, for as long as the room is open here.
	peopleMu sync.Mutex
	people   map[string]*limits
	// subscribed turns true on Redis's first confirmation. Any later one means
	// the subscription was lost and restored.
	subscribed atomic.Bool
	// renewed is set once this server has checked a kept room's titles.
	renewed bool
}

func (r *liveRoom) limitsFor(userID string) *limits {
	r.peopleMu.Lock()
	defer r.peopleMu.Unlock()
	if r.people == nil {
		r.people = make(map[string]*limits)
	}
	if _, found := r.people[userID]; !found {
		r.people[userID] = newLimits()
	}
	return r.people[userID]
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
			Member  bool   `json:"member"`
			Kick    bool   `json:"kick"`
			// MembersOnly means the room has just closed to guests.
			MembersOnly bool `json:"membersOnly"`
			// Host is who a handover has just made the owner.
			Host string `json:"host"`
		} `json:"d"`
	}
	if err := json.Unmarshal(payload, &head); err == nil {
		if head.Data.Version > 0 {
			r.dirty.Store(true)
		}
		if head.Type == "member.rename" {
			r.renamed(head.Data.UserID, head.Data.Name)
		}
		if head.Type == "crew" && head.Data.UserID != "" {
			r.rosterChanged(head.Data.UserID, head.Data.Member, head.Data.Kick)
		}
		if head.Type == "crew" && head.Data.MembersOnly {
			r.closeToGuests()
		}
		if head.Type == "crew" && head.Data.Host != "" {
			r.hostChanged(head.Data.Host)
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

// rosterChanged keeps this person's local tabs true to the roster, wherever the
// change came from. Closing a socket sends them back through the ticket, which
// says why they can't come in.
func (r *liveRoom) rosterChanged(userID string, member, kick bool) {
	ctx, cancel := opContext()
	defer cancel()
	changed := false
	for c := range r.conns {
		if c.who().UserID != userID {
			continue
		}
		c.setMember(member)
		changed = true
		if kick {
			c.shut(websocket.StatusPolicyViolation, "removed from the crew")
			continue
		}
		if err := r.hub.live.Touch(ctx, r.id, c.id, c.who()); err != nil {
			r.hub.log.Warn("presence write failed", "room", r.id, "error", err)
		}
	}
	if changed {
		r.publishMembers(ctx)
	}
}

// closeToGuests ends the visit of everyone off the roster, and their call, which
// would outlive the socket. The host stays regardless: the event that put them on
// the roster can be lost, and locking a room must not lock out the one locking it.
func (r *liveRoom) closeToGuests() {
	for c := range r.conns {
		person := c.who()
		if person.Member || person.Role == room.RoleHost {
			continue
		}
		c.shut(websocket.StatusPolicyViolation, "members only")
		r.hub.owesCall(seat{r.id, person.UserID})
	}
}

// hostChanged moves the host's role on open sockets, where it was fixed by the
// ticket. Otherwise a handover gives the old owner control until they next
// reconnect, and keeps it from the new one.
func (r *liveRoom) hostChanged(host string) {
	ctx, cancel := opContext()
	defer cancel()
	for c := range r.conns {
		role := room.RoleMember
		if c.who().UserID == host {
			role = room.RoleHost
		}
		c.setRole(role)
		if err := r.hub.live.Touch(ctx, r.id, c.id, c.who()); err != nil {
			r.hub.log.Warn("presence write failed", "room", r.id, "error", err)
		}
	}
	r.publishMembers(ctx)
	r.settleHost(ctx)
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
	r.settleDepartures(ctx)
}

// settleHost hands the room to the next person when its host has been gone a
// while, and back when they return. The clock lives in Redis and the decision goes
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
		owner := people[i]
		r.noteHost(ctx, owner.Name, now)
		if state.ActingHost != "" && r.passHost(ctx, "") {
			r.publishNotice(ctx, map[string]string{"kind": "host", "text": owner.Name + " is back, so they’re the host again."})
		}
		return
	}
	if i := slices.IndexFunc(people, func(p store.Person) bool { return p.UserID == state.ActingHost }); i >= 0 {
		r.noteHost(ctx, people[i].Name, now)
		return
	}
	if len(people) == 0 {
		return
	}
	name, seen, err := r.hub.live.HostLastSeen(ctx, r.id, now)
	if err != nil || now-seen < r.hub.hostGrace.Milliseconds() {
		return
	}
	if name == "" {
		name = "The host"
	}
	next := nextInLine(people)
	if r.passHost(ctx, next.UserID) {
		r.publishNotice(ctx, map[string]string{"kind": "host", "text": name + " left, so " + next.Name + " is the host now."})
	}
}

func (r *liveRoom) noteHost(ctx context.Context, name string, at int64) {
	if err := r.hub.live.HostSeen(ctx, r.id, name, at); err != nil {
		r.hub.log.Warn("host presence failed", "room", r.id, "error", err)
	}
}

func (r *liveRoom) passHost(ctx context.Context, userID string) bool {
	passed := r.applySystem(ctx, room.Command{Type: room.CmdHostPass, Target: userID})
	if passed {
		r.publishMembers(ctx)
	}
	return passed
}

// nextInLine is whoever has been here longest, the same on every server.
func nextInLine(people []store.Person) store.Person {
	return slices.MinFunc(people, func(a, b store.Person) int {
		return cmp.Or(cmp.Compare(a.Since, b.Since), cmp.Compare(a.UserID, b.UserID))
	})
}

// settleFailures moves on from a video the people still here can't play. Reports
// decide this as they arrive, but someone leaving can tip it with no report at all.
func (r *liveRoom) settleFailures(ctx context.Context, people []store.Person) {
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found || state.Playback.ItemID == "" || len(state.Queue) == 0 {
		return
	}
	item := state.Queue[0]
	failing, err := r.hub.live.Failing(ctx, r.id, item.ID)
	if err != nil || !mostAreFailing(people, failing) {
		return
	}
	if r.applySystem(ctx, room.Command{Type: room.CmdSkip, Item: item.ID}) {
		r.publishNotice(ctx, skippedNotice(item, wontLoad))
	}
}

// mostAreFailing counts only those still here. Someone who left isn't watching.
func mostAreFailing(people []store.Person, failing []string) bool {
	here := 0
	for _, person := range people {
		if slices.Contains(failing, person.UserID) {
			here++
		}
	}
	return here*2 > len(people)
}

func (r *liveRoom) publishNotice(ctx context.Context, notice map[string]string) {
	r.say(ctx, notice["text"], notice["url"])
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

// roster is who to show in the room, with any stand-in shown as the host.
func (r *liveRoom) roster(ctx context.Context) ([]store.Person, error) {
	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		return nil, err
	}
	state, found, err := r.hub.live.Load(ctx, r.id)
	if err != nil || !found {
		return people, err
	}
	return store.WithActingHost(people, state), nil
}

func (r *liveRoom) publishMembers(ctx context.Context) {
	people, err := r.roster(ctx)
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

// renewMedia runs at a room's first join. A crew room can sit for weeks, and what
// it queued then may have changed or gone by the time anyone comes back.
func (r *liveRoom) renewMedia(ctx context.Context, state room.State) {
	if r.renewed || len(state.Queue) == 0 {
		return
	}
	r.renewed = true
	access, err := r.hub.db.CrewAccessOf(ctx, r.id, "")
	if err != nil || !access.Exists {
		return
	}
	fresh, err := r.hub.db.FreshMedia(ctx, state.Queue)
	if err != nil {
		r.hub.log.Warn("media refresh failed", "room", r.id, "error", err)
		return
	}
	r.applySystem(ctx, room.Command{Type: room.CmdMediaRefresh, Fresh: fresh})
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
	var before room.State
	attempt := func() (room.State, error) {
		return r.hub.live.Mutate(ctx, r.id,
			func(state room.State) (room.State, error) {
				next, applied, err := room.Apply(state, actor, cmd, time.Now().UnixMilli())
				change, before = applied, state
				return next, err
			},
			func(state room.State) ([]byte, error) { return encodeApplied(before.Queue, state, change), nil },
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
		if text := room.Narrate(before, state, change); text != "" {
			r.say(ctx, text, "")
		}
	}
	return state, err
}

// say adds to what the room has said, for those here and those yet to arrive.
func (r *liveRoom) say(ctx context.Context, text, url string) {
	line := store.Line{ID: ids.New(), Text: text, URL: url, CreatedAt: time.Now().UTC()}
	err := r.hub.live.AddLine(ctx, r.id, line)
	if err == nil {
		err = r.hub.live.Publish(ctx, r.id, encode("line", line))
	}
	if err != nil {
		r.hub.log.Warn("line failed", "room", r.id, "error", err)
	}
}

// arrived says someone joined, unless they never really went. Another tab isn't
// an arrival, and nor is whoever opens an empty room.
func (r *liveRoom) arrived(ctx context.Context, person store.Person, tabs, others int) {
	if tabs > 0 {
		return
	}
	gone, found, err := r.hub.live.TakeGone(ctx, r.id, person.UserID)
	if err != nil {
		r.hub.log.Warn("departure read failed", "room", r.id, "error", err)
	}
	reloaded := found && time.Now().UnixMilli()-gone.At < r.hub.rejoinQuiet.Milliseconds()
	if !reloaded && others > 0 {
		r.say(ctx, person.Name+" joined", "")
	}
}

// settleDepartures says who left, once they have been gone too long for a reload.
func (r *liveRoom) settleDepartures(ctx context.Context) {
	departures, err := r.hub.live.Departures(ctx, r.id)
	if err != nil || len(departures) == 0 {
		return
	}
	people, err := r.hub.live.People(ctx, r.id)
	if err != nil {
		return
	}
	cutoff := time.Now().UnixMilli() - r.hub.rejoinQuiet.Milliseconds()
	for _, departure := range departures {
		if departure.At > cutoff {
			continue
		}
		if _, claimed, err := r.hub.live.TakeGone(ctx, r.id, departure.UserID); err != nil || !claimed {
			continue
		}
		// They came back before this was written, so their join couldn't clear it.
		if slices.ContainsFunc(people, func(p store.Person) bool { return p.UserID == departure.UserID }) {
			continue
		}
		if !departure.Quiet {
			r.say(ctx, departure.Name+" left", "")
		}
		r.vacate(ctx, departure.UserID)
	}
}

func (r *liveRoom) join(c *conn, ticket store.Ticket) {
	if r.hub.isClosing() {
		c.shut(websocket.StatusGoingAway, "server restarting")
		return
	}
	ctx, cancel := opContext()
	defer cancel()
	person := c.arrive(time.Now().UnixMilli())

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
	r.renewMedia(ctx, state)
	if latest, found, err := r.hub.live.Load(ctx, r.id); err == nil && found {
		state = latest
	}

	tabs, _ := r.hub.live.Sockets(ctx, r.id, person.UserID)
	here, _ := r.hub.live.People(ctx, r.id)
	if err := r.hub.live.Touch(ctx, r.id, c.id, person); err != nil {
		r.hub.log.Warn("presence write failed", "room", r.id, "error", err)
	}
	r.conns[c] = struct{}{}
	r.arrived(ctx, person, tabs, len(here))
	r.hub.recorder.Joined(r.id, person)

	people, err := r.roster(ctx)
	if err != nil {
		r.hub.log.Warn("presence read failed", "room", r.id, "error", err)
	}
	self := person
	self.Role = state.RoleOf(person.UserID, person.Role)
	lines, err := r.hub.live.Lines(ctx, r.id)
	if err != nil {
		r.hub.log.Warn("lines read failed", "room", r.id, "error", err)
	}
	c.send(encode("welcome", map[string]any{
		"self":    self,
		"lines":   lines,
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

// departed is the chat's side of someone's last socket closing. A host's going is
// told by the handover, and anyone else's waits in case it is only a reload.
func (r *liveRoom) departed(ctx context.Context, person store.Person, said, hosting bool) {
	if !said {
		gone := store.Departure{UserID: person.UserID, Name: person.Name, At: time.Now().UnixMilli(), Quiet: hosting}
		if err := r.hub.live.MarkGone(ctx, r.id, gone); err != nil {
			r.hub.log.Warn("departure write failed", "room", r.id, "error", err)
		}
		return
	}
	if !hosting {
		r.say(ctx, person.Name+" left", "")
	}
	r.vacate(ctx, person.UserID)
}

// vacate tells viewers to stop keeping someone's seat.
func (r *liveRoom) vacate(ctx context.Context, userID string) {
	if err := r.hub.live.Publish(ctx, r.id, encode("vacated", map[string]string{"userId": userID})); err != nil {
		r.hub.log.Warn("vacated failed", "room", r.id, "error", err)
	}
}

// leave runs for every closed socket. said is true when the viewer pressed Leave,
// and a drop or reload gets the grace period instead.
func (r *liveRoom) leave(c *conn, said bool) {
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
	hosting := false
	if state, found, err := r.hub.live.Load(ctx, r.id); err == nil && found {
		hosting = state.RoleOf(person.UserID, person.Role) == room.RoleHost
	}
	if hosting {
		// The grace period counts from now, not from the last presence refresh.
		seen := time.Now().UnixMilli()
		if said {
			seen -= r.hub.hostGrace.Milliseconds()
		}
		r.noteHost(ctx, person.Name, seen)
	}

	people, err := r.hub.live.People(ctx, r.id)
	if err == nil && !slices.ContainsFunc(people, func(p store.Person) bool { return p.UserID == person.UserID }) {
		r.hub.recorder.Left(r.id, person.UserID)
		r.departed(ctx, person, said, hosting)
	}
	if err == nil && len(people) > 0 {
		r.settleHost(ctx)
		r.settleFailures(ctx, people)
	}
	if err == nil && len(people) == 0 {
		if err := r.hub.live.MarkEmpty(ctx, r.id, time.Now().UnixMilli()); err != nil {
			r.hub.log.Warn("empty mark failed", "room", r.id, "error", err)
		}
		r.dirty.Store(true)
		r.saveSnapshot()
	}
}
