package hub

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"stream2gather/internal/room"
)

func TestACommandThatWaitedOutAStallIsNotApplied(t *testing.T) {
	r := newRig(t, testRedis, func(h *Hub) { h.commandPatience = 50 * time.Millisecond })
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)

	// The room's goroutine stalls, the way it does behind a hung Redis.
	r.hub.mu.Lock()
	stalled := r.hub.rooms[id]
	r.hub.mu.Unlock()
	stalled.do(func() { time.Sleep(200 * time.Millisecond) })

	c.sendWithID(t, "late", room.CmdPause, map[string]any{"item": "item1", "pos": 99, "ct": time.Now().UnixMilli()})
	c.expectWhere(t, "error", func(data json.RawMessage) bool { return strings.Contains(string(data), "unavailable") })

	eventually(t, "the room never recovered", func() bool {
		state, _, err := r.live.Load(t.Context(), id)
		return err == nil && state.Playback.Status == room.StatusPlaying
	})
}
