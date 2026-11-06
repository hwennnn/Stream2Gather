package hub

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/coder/websocket"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

func crewEvent(t *testing.T, r *rig, roomID string, data map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"t": "crew", "d": data})
	if err := r.live.Publish(context.Background(), roomID, body); err != nil {
		t.Fatal(err)
	}
}

func TestJoiningTheCrewShowsInPresenceWithoutReconnecting(t *testing.T) {
	r := newRig(t, testRedis)
	id, user := r.newRoom(t, room.New()), "u_"+ids.New()
	c := r.joined(t, id, user, room.RoleMember)

	crewEvent(t, r, id, map[string]any{"changed": "members", "userId": user, "member": true})

	c.expect(t, "crew")
	c.expectWhere(t, "members", func(data json.RawMessage) bool {
		var event struct {
			Members []store.Person `json:"members"`
		}
		return json.Unmarshal(data, &event) == nil && len(event.Members) == 1 && event.Members[0].Member
	})
}

func TestRemovalFromAMembersOnlyRoomClosesThatPersonsSockets(t *testing.T) {
	r := newRig(t, testRedis)
	id, removed, stays := r.newRoom(t, room.New()), "u_"+ids.New(), "u_"+ids.New()
	gone := r.joined(t, id, removed, room.RoleMember)
	other := r.joined(t, id, stays, room.RoleMember)

	crewEvent(t, r, id, map[string]any{"changed": "members", "userId": removed, "kick": true})

	select {
	case code := <-gone.closed:
		if code != websocket.StatusPolicyViolation {
			t.Fatalf("close code = %d", code)
		}
	case <-time.After(waitFor):
		t.Fatal("still connected")
	}
	other.expect(t, "crew")
	select {
	case code := <-other.closed:
		t.Fatalf("someone else was closed too: %d", code)
	default:
	}
}
