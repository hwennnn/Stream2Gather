package hub

import (
	"testing"
	"time"

	"github.com/coder/websocket"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

func capped(roomID, userID, role string, limit int) store.Ticket {
	return store.Ticket{
		RoomID: roomID, RoomSlug: roomID, MaxMembers: limit,
		Person: store.Person{UserID: userID, Name: userID, Role: role},
	}
}

func TestATicketDoesNotBeatTheMemberCap(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	r.dialTicket(t, capped(id, "a", room.RoleMember, 2)).expect(t, "welcome")
	r.dialTicket(t, capped(id, "b", room.RoleMember, 2)).expect(t, "welcome")

	third := r.dialTicket(t, capped(id, "c", room.RoleMember, 2))
	select {
	case code := <-third.closed:
		if code != websocket.StatusPolicyViolation {
			t.Fatalf("closed with %d", code)
		}
	case <-time.After(waitFor):
		t.Fatal("a third person joined a room of two")
	}
}

func TestSomeoneAlreadyHereCanOpenAnotherTabInAFullRoom(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	r.dialTicket(t, capped(id, "a", room.RoleMember, 1)).expect(t, "welcome")
	r.dialTicket(t, capped(id, "a", room.RoleMember, 1)).expect(t, "welcome")
}

func TestTheOwnerIsNeverOverTheCap(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	r.dialTicket(t, capped(id, "a", room.RoleMember, 1)).expect(t, "welcome")
	r.dialTicket(t, capped(id, "owner", room.RoleHost, 1)).expect(t, "welcome")
}
