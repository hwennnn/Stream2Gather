package hub

import (
	"context"
	"testing"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
)

// slowSource holds a lookup open until the test lets it go.
type slowSource struct {
	source.Direct
	release chan struct{}
}

func (s slowSource) Resolve(ctx context.Context, ref source.Ref) (room.Media, error) {
	<-s.release
	return s.Direct.Resolve(ctx, ref)
}

func TestASlowLookupDoesNotStopTheSocketAnswering(t *testing.T) {
	slow := slowSource{release: make(chan struct{})}
	r := newRig(t, testRedis, func(h *Hub) { h.catalog = source.NewCatalog(h.db, 0, h.log, slow) })
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)

	c.sendWithID(t, "add", "queue.add", map[string]string{"url": "https://a.test/" + ids.New() + ".mp4"})
	c.send(t, "ping", map[string]any{"t0": 1})
	c.expect(t, "pong")

	close(slow.release)
	if got := decodeState(t, c.expect(t, "state")); got.Patch == nil || got.Patch.Size != 2 || len(got.Patch.Items) != 1 {
		t.Fatalf("patch = %+v", got.Patch)
	}
}
