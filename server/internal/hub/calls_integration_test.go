package hub

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"stream2gather/internal/ids"
)

// calls stands in for the voice server.
type calls struct {
	mu      sync.Mutex
	removed []seat
	refuse  int
}

func (c *calls) leave(_ context.Context, roomID, userID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.removed = append(c.removed, seat{roomID, userID})
	if c.refuse > 0 {
		c.refuse--
		return errors.New("voice server is down")
	}
	return nil
}

func (c *calls) seen() []seat {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.removed)
}

func TestSigningOutEndsTheirCallAndNobodyElses(t *testing.T) {
	voice := &calls{}
	r := newRig(t, testRedis, fastSessionChecks, func(h *Hub) { h.LeaveCall = voice.leave })
	id := r.newRoom(t, directVideo(t))
	leaving, staying := "u_"+ids.New(), "u_"+ids.New()
	gone := r.dialTicket(t, accountTicket(id, leaving, 0))
	gone.expect(t, "welcome")
	r.dialTicket(t, accountTicket(id, staying, 0)).expect(t, "welcome")

	if err := r.db.BumpSessionVersion(context.Background(), leaving); err != nil {
		t.Fatal(err)
	}

	eventually(t, "they leave the call", func() bool { return len(voice.seen()) > 0 })
	for _, removed := range voice.seen() {
		if removed != (seat{id, leaving}) {
			t.Fatalf("removed %+v", removed)
		}
	}
}

func TestARemovalThatFailsIsTriedAgain(t *testing.T) {
	voice := &calls{refuse: 2}
	r := newRig(t, testRedis, fastSessionChecks, func(h *Hub) { h.LeaveCall = voice.leave })
	id := r.newRoom(t, directVideo(t))
	user := "u_" + ids.New()
	r.dialTicket(t, accountTicket(id, user, 0)).expect(t, "welcome")

	if err := r.db.BumpSessionVersion(context.Background(), user); err != nil {
		t.Fatal(err)
	}

	eventually(t, "the third try", func() bool { return len(voice.seen()) >= 3 })
	settled := len(voice.seen())
	time.Sleep(150 * time.Millisecond)
	if now := len(voice.seen()); now != settled {
		t.Fatalf("still removing after it worked: %d then %d", settled, now)
	}
}

func TestSomeoneBackInKeepsTheirCall(t *testing.T) {
	voice := &calls{}
	r := newRig(t, testRedis, func(h *Hub) {
		h.sessionCheck = time.Hour
		h.LeaveCall = voice.leave
	})
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	user := "u_" + ids.New()
	before := r.dialTicket(t, accountTicket(id, user, 0))
	before.expect(t, "welcome")
	if err := r.db.BumpSessionVersion(ctx, user); err != nil {
		t.Fatal(err)
	}
	version, err := r.db.SessionVersion(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	r.dialTicket(t, accountTicket(id, user, version)).expect(t, "welcome")

	r.hub.endSignedOut(ctx)

	select {
	case <-before.closed:
	case <-time.After(waitFor):
		t.Fatal("the old session's socket stayed open")
	}
	if removed := voice.seen(); len(removed) != 0 {
		t.Fatalf("removed from the call they came back to: %+v", removed)
	}
}
