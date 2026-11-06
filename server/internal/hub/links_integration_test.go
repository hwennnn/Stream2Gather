package hub

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
)

// deadLinks answers like a video site for links that lead nowhere, and counts.
type deadLinks struct {
	source.Direct
	calls atomic.Int32
}

func (d *deadLinks) Metered() {}
func (d *deadLinks) Resolve(context.Context, source.Ref) (room.Media, error) {
	d.calls.Add(1)
	return room.Media{}, source.ErrUnavailable
}

func TestQueueAddChargesTheAddressForDeadLinks(t *testing.T) {
	dead := &deadLinks{}
	r := newRig(t, testRedis, func(h *Hub) { h.catalog = source.NewCatalog(h.db, 0, h.log, dead) })
	ctx := context.Background()
	address := "links-" + ids.New()
	for range source.LookupsPerHour {
		if _, err := r.live.Limit(ctx, "lookups:"+address, source.LookupsPerHour, time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	id := r.newRoom(t, directVideo(t))
	c := r.dialTicket(t, store.Ticket{RoomID: id, RoomSlug: id, Address: address, Person: store.Person{UserID: "u", Name: "u"}})
	c.expect(t, "welcome")

	c.sendWithID(t, "q", "queue.add", map[string]string{"url": "https://a.test/" + ids.New() + ".mp4"})
	c.expectWhere(t, "error", func(data json.RawMessage) bool {
		return strings.Contains(string(data), source.ErrTooManyLinks.Error())
	})
	if dead.calls.Load() != 0 {
		t.Fatalf("the source was called %d times over the limit", dead.calls.Load())
	}
}
