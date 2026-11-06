package hub

import (
	"context"
	"encoding/json"
	"strings"
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

func TestLockingARoomSendsGuestsHomeAndKeepsTheCrew(t *testing.T) {
	r := newRig(t, testRedis)
	id, guest, member := r.newRoom(t, room.New()), "u_"+ids.New(), "u_"+ids.New()
	out := r.joined(t, id, guest, room.RoleMember)
	in := r.joined(t, id, member, room.RoleMember)
	crewEvent(t, r, id, map[string]any{"changed": "members", "userId": member, "member": true})
	in.expect(t, "crew")

	crewEvent(t, r, id, map[string]any{"changed": "settings", "membersOnly": true})

	select {
	case code := <-out.closed:
		if code != websocket.StatusPolicyViolation {
			t.Fatalf("close code = %d", code)
		}
	case <-time.After(waitFor):
		t.Fatal("a guest stayed in a room that was locked")
	}
	in.expect(t, "crew")
	select {
	case code := <-in.closed:
		t.Fatalf("a member was sent home too: %d", code)
	default:
	}
}

func TestAHandoverMovesControlOnOpenSockets(t *testing.T) {
	r := newRig(t, testRedis)
	id, was, now := r.newRoom(t, room.New()), "u_"+ids.New(), "u_"+ids.New()
	before := r.joined(t, id, was, room.RoleHost)
	after := r.joined(t, id, now, room.RoleMember)

	crewEvent(t, r, id, map[string]any{"changed": "settings", "host": now})
	before.expect(t, "crew")
	after.expect(t, "crew")

	settings := map[string]any{"settings": room.Settings{ControlMode: room.ModeHosts, QueueMode: room.ModeHosts}}
	before.sendWithID(t, "was", room.CmdSettings, settings)
	if refused := before.expect(t, "error"); !strings.Contains(string(refused.D), "forbidden") {
		t.Fatalf("the old owner got %s", refused.D)
	}
	after.sendWithID(t, "now", room.CmdSettings, settings)
	after.expect(t, "ack")

	people, err := r.live.People(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	for _, person := range people {
		if wanted := person.UserID == now; wanted != (person.Role == room.RoleHost) {
			t.Fatalf("%s is %s after the handover", person.UserID, person.Role)
		}
	}
}
