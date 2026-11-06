package hub

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"stream2gather/internal/room"
)

func TestAViewerFollowsEveryKindOfQueueChangeFromPatches(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	// Three of them, or this many commands would meet the limit on one person.
	actors := []*client{
		r.joined(t, id, "a", room.RoleMember),
		r.joined(t, id, "b", room.RoleMember),
		r.joined(t, id, "c", room.RoleMember),
	}
	viewer := r.joined(t, id, "viewer", room.RoleMember)

	load := func() room.State {
		t.Helper()
		state, found, err := r.live.Load(ctx, id)
		if err != nil || !found {
			t.Fatalf("load: %v %v", found, err)
		}
		return state
	}
	queue := load().Queue

	steps := 0
	step := func(kind string, data map[string]any) {
		t.Helper()
		steps++
		actor := actors[steps%len(actors)]
		actor.sendWithID(t, fmt.Sprint("step", steps), kind, data)
		actor.expect(t, "ack")
		got := decodeState(t, viewer.expect(t, "state"))
		if got.Patch == nil {
			t.Fatalf("%s carried no patch", kind)
		}
		queue = apply(t, queue, got.Patch)
		if state := load(); !slices.Equal(queue, state.Queue) || got.Version != state.Version {
			t.Fatalf("after %s the viewer has %+v at %d, the room %+v at %d", kind, queue, got.Version, state.Queue, state.Version)
		}
	}

	for _, mode := range []string{"end", "end", "next", "end"} {
		step(room.CmdQueueAdd, map[string]any{"url": fmt.Sprintf("https://a.test/%d.mp4", steps), "mode": mode})
	}
	step(room.CmdQueueMove, map[string]any{"target": queue[1].ID, "index": len(queue) - 1})
	step(room.CmdQueueMove, map[string]any{"target": queue[len(queue)-1].ID, "index": 1})
	step(room.CmdQueueRemove, map[string]any{"target": queue[2].ID})
	step(room.CmdQueueAdd, map[string]any{"url": "https://a.test/now.mp4", "mode": "now"})
	step(room.CmdQueueUndo, map[string]any{"target": queue[0].ID})
	step(room.CmdQueuePlay, map[string]any{"target": queue[2].ID})
	step(room.CmdQueueUndo, map[string]any{"target": queue[0].ID})
	for len(queue) > 0 {
		step(room.CmdSkip, map[string]any{"item": queue[0].ID})
	}
}
