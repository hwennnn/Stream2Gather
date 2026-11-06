package hub

import (
	"context"
	"log/slog"
	"slices"
	"sync/atomic"
	"time"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// The kinds of Moment.
const (
	MomentReaction = "reaction"
	MomentChat     = "chat"
)

// Moment is a reaction or chat line, before anyone has worked out its position.
type Moment struct {
	Kind      string
	UserID    string
	Author    string
	Emoji     string
	MessageID int64
	At        time.Time
}

// Recorder hears what happens in rooms. Every method but Run is called from a
// room's hot path, so none may block. Track A owns this file.
type Recorder interface {
	// Run does the recorder's work until ctx ends. Hub.Run starts it.
	Run(ctx context.Context)
	// Applied sees every state change, system commands included, and what it replaced.
	Applied(roomID string, before, after room.State)
	// Joined fires for each connection, so a second tab fires it again.
	Joined(roomID string, p store.Person)
	// Left fires once the person has no connection left, on any server.
	Left(roomID, userID string)
	Moment(roomID string, m Moment)
	// Dropped counts events lost to a full channel or a failed write.
	Dropped() int64
}

// newRecorder is where the hub gets its recorder.
func newRecorder(h *Hub) Recorder {
	c := newCapture(h.db, h.live, h.log)
	c.report = func(total int64) {
		if h.Metric != nil {
			h.Metric("recorder_dropped_total", float64(total))
		}
	}
	return c
}

const (
	recorderBacklog = 4096
	flushEvery      = time.Second
	// crewCacheFor is how long a room's crew, or its lack of one, is believed. A
	// room just promoted starts capturing within this.
	crewCacheFor = 30 * time.Second
	flushTimeout = 5 * time.Second
)

// captureStore is what the recorder writes to.
type captureStore interface {
	CrewIDOfRoom(ctx context.Context, roomID string) (string, error)
	RecordCapture(ctx context.Context, c store.Capture) error
}

// roomReader is what the recorder reads from.
type roomReader interface {
	Load(ctx context.Context, roomID string) (room.State, bool, error)
	People(ctx context.Context, roomID string) ([]store.Person, error)
}

type recorded struct {
	roomID string
	state  *room.State
	before *room.State
	joined *store.Person
	left   string
	moment *Moment
}

type knownCrew struct {
	id    string
	until time.Time
}

// capture writes crew rooms' activity to Postgres a second at a time. Losing
// events costs a recap some detail, so it drops them rather than slow a room.
type capture struct {
	db      captureStore
	live    roomReader
	log     *slog.Logger
	events  chan recorded
	dropped atomic.Int64
	crews   map[string]knownCrew
	report  func(total int64)
}

func newCapture(db captureStore, live roomReader, log *slog.Logger) *capture {
	return &capture{
		db: db, live: live, log: log,
		events: make(chan recorded, recorderBacklog),
		crews:  make(map[string]knownCrew),
		report: func(int64) {},
	}
}

func (c *capture) send(event recorded) {
	select {
	case c.events <- event:
	default:
		c.dropped.Add(1)
	}
}

func (c *capture) Applied(roomID string, before, after room.State) {
	c.send(recorded{roomID: roomID, state: &after, before: &before})
}
func (c *capture) Joined(roomID string, p store.Person) { c.send(recorded{roomID: roomID, joined: &p}) }
func (c *capture) Left(roomID, userID string)           { c.send(recorded{roomID: roomID, left: userID}) }
func (c *capture) Moment(roomID string, m Moment)       { c.send(recorded{roomID: roomID, moment: &m}) }

// Dropped is recorder_dropped_total.
func (c *capture) Dropped() int64 { return c.dropped.Load() }

// Run collects events and flushes them until ctx ends.
func (c *capture) Run(ctx context.Context) {
	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()
	pending := make(map[string][]recorded)
	reported := int64(0)
	for {
		select {
		case <-ctx.Done():
			c.log.Info("recorder stopped", "recorder_dropped_total", c.dropped.Load())
			return
		case event := <-c.events:
			pending[event.roomID] = append(pending[event.roomID], event)
		case <-ticker.C:
			for roomID, events := range pending {
				c.flush(ctx, roomID, events)
			}
			clear(pending)
			if total := c.dropped.Load(); total != reported {
				reported = total
				c.log.Warn("recorder dropped events", "recorder_dropped_total", total)
				c.report(total)
			}
		}
	}
}

func (c *capture) flush(ctx context.Context, roomID string, events []recorded) {
	ctx, cancel := context.WithTimeout(ctx, flushTimeout)
	defer cancel()
	crewID, err := c.crewOf(ctx, roomID)
	if err == nil && crewID != "" {
		err = c.write(ctx, roomID, crewID, events)
	}
	if err != nil {
		c.dropped.Add(int64(len(events)))
		c.log.Warn("recorder flush failed", "room", roomID, "events", len(events), "error", err)
	}
}

func (c *capture) crewOf(ctx context.Context, roomID string) (string, error) {
	now := time.Now()
	if known, ok := c.crews[roomID]; ok && now.Before(known.until) {
		return known.id, nil
	}
	id, err := c.db.CrewIDOfRoom(ctx, roomID)
	if err != nil {
		return "", err
	}
	// Rooms come and go, so the cache starts again rather than grow.
	if len(c.crews) >= recorderBacklog {
		clear(c.crews)
	}
	c.crews[roomID] = knownCrew{id: id, until: now.Add(crewCacheFor)}
	return id, nil
}

// write turns events into one Capture. Events arrive in order, so a moment is
// placed against the state it happened in: what the batch's first change replaced,
// then each change in turn. Live state alone is what the batch ended on.
func (c *capture) write(ctx context.Context, roomID, crewID string, events []recorded) error {
	state, found, err := c.live.Load(ctx, roomID)
	if err != nil {
		return err
	}
	if !found {
		return nil
	}
	present, err := c.live.People(ctx, roomID)
	if err != nil {
		return err
	}
	batch := store.Capture{CrewID: crewID, At: time.Now(), Present: present}
	placed := state
	if first := slices.IndexFunc(events, func(e recorded) bool { return e.state != nil }); first >= 0 {
		placed = *events[first].before
	}
	for _, event := range events {
		switch {
		case event.state != nil:
			placed = *event.state
			batch.Active = true
		case event.joined != nil:
			batch.Joined = append(batch.Joined, *event.joined)
			// A reload is a leave and a join, and the store seats before it unseats.
			batch.Left = slices.DeleteFunc(batch.Left, func(id string) bool { return id == event.joined.UserID })
		case event.left != "":
			batch.Left = append(batch.Left, event.left)
		case event.moment != nil:
			batch.Active = true
			if moment, ok := placeMoment(placed, *event.moment); ok {
				batch.Moments = append(batch.Moments, moment)
			}
		}
	}
	if item, ok := playingItem(placed); ok {
		batch.Source, batch.SourceID = item.Source, item.SourceID
		batch.Playing = placed.Playback.Status == room.StatusPlaying
	}
	return c.db.RecordCapture(ctx, batch)
}

func playingItem(s room.State) (room.Item, bool) {
	for _, item := range s.Queue {
		if item.ID == s.Playback.ItemID {
			return item, true
		}
	}
	return room.Item{}, false
}

// placeMoment says where in the video something happened. With nothing on,
// there's nowhere to put it.
func placeMoment(s room.State, m Moment) (store.CapturedMoment, bool) {
	item, ok := playingItem(s)
	if !ok {
		return store.CapturedMoment{}, false
	}
	return store.CapturedMoment{
		Kind: m.Kind, UserID: m.UserID, Author: m.Author, Emoji: m.Emoji, MessageID: m.MessageID,
		Source: item.Source, SourceID: item.SourceID,
		PosMs: int64(s.PositionAt(m.At.UnixMilli()) * 1000), At: m.At,
	}, true
}
