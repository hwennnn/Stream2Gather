package hub

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"stream2gather/internal/room"
)

// A row lock makes the room's save hang, the way a stuck database does.
func TestAHungDatabaseDoesNotHoldUpPlayback(t *testing.T) {
	r := newRig(t, testRedis, func(h *Hub) { h.snapshots = 10 * time.Millisecond })
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)

	lock, err := r.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Rollback(ctx) }()
	if _, err := lock.Exec(ctx, `SELECT 1 FROM rooms WHERE id = $1 FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}

	seek := func(pos float64) {
		r.apply(t, id, room.Command{Type: room.CmdSeek, Item: "item1", Pos: pos, CT: time.Now().UnixMilli()})
		c.expectWhere(t, "playback", func(data json.RawMessage) bool {
			var event struct {
				Playback room.Playback `json:"playback"`
			}
			return json.Unmarshal(data, &event) == nil && event.Playback.Pos == pos
		})
	}
	seek(10)
	time.Sleep(100 * time.Millisecond) // The save is now stuck behind the lock.
	seek(20)
}

func TestTheLastViewersStateIsSavedAfterTheRoomCloses(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)
	r.apply(t, id, room.Command{Type: room.CmdSeek, Item: "item1", Pos: 42, CT: time.Now().UnixMilli()})
	c.expect(t, "playback")

	_ = c.ws.CloseNow()

	eventually(t, "the room closed without saving", func() bool {
		state, _, err := r.db.LoadSnapshot(ctx, id)
		return err == nil && state.Playback.Pos == 42
	})
}
