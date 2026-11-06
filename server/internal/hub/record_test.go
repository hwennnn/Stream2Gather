package hub

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

type fakeCaptureStore struct {
	mu      sync.Mutex
	crew    string
	lookups int
	fail    error
	batches []store.Capture
}

func (f *fakeCaptureStore) CrewIDOfRoom(context.Context, string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lookups++
	return f.crew, nil
}

func (f *fakeCaptureStore) RecordCapture(_ context.Context, c store.Capture) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return f.fail
	}
	f.batches = append(f.batches, c)
	return nil
}

type fakeRoomReader struct{ state room.State }

func (f fakeRoomReader) Load(context.Context, string) (room.State, bool, error) {
	return f.state, true, nil
}
func (f fakeRoomReader) People(context.Context, string) ([]store.Person, error) { return nil, nil }

func playingAt(pos float64, at time.Time) room.State {
	state := room.New()
	state.Queue = []room.Item{{ID: "i", Media: room.Media{Source: "youtube", SourceID: "abc"}}}
	state.Playback = room.Playback{ItemID: "i", Status: room.StatusPlaying, Pos: pos, At: at.UnixMilli(), Rate: 1}
	return state
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestAFullRecorderNeverBlocksAndCountsWhatItDrops(t *testing.T) {
	c := newCapture(&fakeCaptureStore{}, fakeRoomReader{}, quiet())

	done := make(chan struct{})
	go func() {
		defer close(done)
		for range recorderBacklog + 10 {
			c.Moment("r", Moment{Kind: MomentReaction, At: time.Now()})
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a send blocked with nobody reading")
	}
	if got := c.Dropped(); got != 10 {
		t.Fatalf("dropped %d", got)
	}
}

func TestAFailedWriteCountsItsEventsAsDropped(t *testing.T) {
	db := &fakeCaptureStore{crew: "c", fail: errors.New("down")}
	c := newCapture(db, fakeRoomReader{state: playingAt(0, time.Now())}, quiet())

	c.flush(context.Background(), "r", []recorded{{roomID: "r", moment: &Moment{Kind: MomentChat, At: time.Now()}}, {roomID: "r", left: "u"}})

	if got := c.Dropped(); got != 2 {
		t.Fatalf("dropped %d", got)
	}
}

func TestARoomWithoutACrewWritesNothingAndIsAskedAboutOnce(t *testing.T) {
	db := &fakeCaptureStore{}
	c := newCapture(db, fakeRoomReader{state: playingAt(0, time.Now())}, quiet())

	for range 3 {
		c.flush(context.Background(), "r", []recorded{{roomID: "r", left: "u"}})
	}

	if len(db.batches) != 0 || db.lookups != 1 {
		t.Fatalf("%d batches, %d lookups", len(db.batches), db.lookups)
	}
}

func TestAMomentLandsWhereTheVideoWasWhenItHappened(t *testing.T) {
	start := time.Now().Add(-time.Minute)
	db := &fakeCaptureStore{crew: "c"}
	c := newCapture(db, fakeRoomReader{state: playingAt(100, start)}, quiet())

	c.flush(context.Background(), "r", []recorded{{roomID: "r", moment: &Moment{Kind: MomentReaction, Emoji: "🔥", At: start.Add(30 * time.Second)}}})

	if len(db.batches) != 1 || len(db.batches[0].Moments) != 1 {
		t.Fatalf("%+v", db.batches)
	}
	batch := db.batches[0]
	if got := batch.Moments[0].PosMs; got != 130_000 {
		t.Fatalf("placed at %d ms", got)
	}
	if !batch.Playing || batch.SourceID != "abc" {
		t.Fatalf("%+v", batch)
	}
}

// A reload lands both inside one flush, and the person is still here after it.
func TestAReloadInsideOneFlushLeavesThePersonHere(t *testing.T) {
	db := &fakeCaptureStore{crew: "c"}
	c := newCapture(db, fakeRoomReader{state: playingAt(0, time.Now())}, quiet())
	hana := store.Person{UserID: "hana", Name: "Hana"}

	c.flush(context.Background(), "r", []recorded{{roomID: "r", left: "hana"}, {roomID: "r", joined: &hana}})

	if left := db.batches[0].Left; len(left) != 0 {
		t.Fatalf("left = %v, so the store marks someone gone who came straight back", left)
	}
}

func TestLeavingForGoodInsideOneFlushStillCounts(t *testing.T) {
	db := &fakeCaptureStore{crew: "c"}
	c := newCapture(db, fakeRoomReader{state: playingAt(0, time.Now())}, quiet())
	hana := store.Person{UserID: "hana", Name: "Hana"}

	c.flush(context.Background(), "r", []recorded{
		{roomID: "r", left: "hana"}, {roomID: "r", joined: &hana}, {roomID: "r", left: "hana"},
	})

	if left := db.batches[0].Left; len(left) != 1 {
		t.Fatalf("left = %v", left)
	}
}

// Applause at the end of a film, then the next one starts inside the same second.
func TestAMomentBelongsToTheVideoItHappenedIn(t *testing.T) {
	start := time.Now().Add(-time.Minute)
	film := playingAt(100, start)
	next := playingAt(0, start.Add(31*time.Second))
	next.Queue = []room.Item{{ID: "n", Media: room.Media{Source: "youtube", SourceID: "next"}}}
	next.Playback.ItemID = "n"
	db := &fakeCaptureStore{crew: "c"}
	c := newCapture(db, fakeRoomReader{state: next}, quiet())

	c.flush(context.Background(), "r", []recorded{
		{roomID: "r", moment: &Moment{Kind: MomentReaction, Emoji: "👏", At: start.Add(30 * time.Second)}},
		{roomID: "r", state: &next, before: &film},
	})

	moment := db.batches[0].Moments[0]
	if moment.SourceID != "abc" || moment.PosMs != 130_000 {
		t.Fatalf("placed in %q at %d ms, want the film at 130000", moment.SourceID, moment.PosMs)
	}
}
