package hub

import (
	"testing"
	"time"

	"github.com/coder/websocket"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

func guestFrom(id, name, address string) store.Ticket {
	return store.Ticket{RoomID: id, RoomSlug: id, Address: address, Person: store.Person{UserID: name, Name: name, Role: room.RoleMember}}
}

func TestAnAddressCannotHoldMoreThanItsShareOfSockets(t *testing.T) {
	r := newRig(t, testRedis, func(h *Hub) { h.maxPerAddress = 2 })
	id := r.newRoom(t, directVideo(t))

	first := r.dialTicket(t, guestFrom(id, "a", "203.0.113.1"))
	second := r.dialTicket(t, guestFrom(id, "b", "203.0.113.1"))
	for _, c := range []*client{first, second} {
		if _, ok := c.next("welcome", 3*time.Second); !ok {
			t.Fatal("someone inside the limit was not let in")
		}
	}

	third := r.dialTicket(t, guestFrom(id, "c", "203.0.113.1"))
	select {
	case code := <-third.closed:
		if code != websocket.StatusPolicyViolation {
			t.Fatalf("closed with %d", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a third socket stayed open on an address allowed two")
	}

	elsewhere := r.dialTicket(t, guestFrom(id, "d", "203.0.113.2"))
	if _, ok := elsewhere.next("welcome", 3*time.Second); !ok {
		t.Fatal("one address's limit reached another")
	}
}

func TestLeavingGivesAnAddressItsPlaceBack(t *testing.T) {
	r := newRig(t, testRedis, func(h *Hub) { h.maxPerAddress = 1 })
	id := r.newRoom(t, directVideo(t))

	first := r.dialTicket(t, guestFrom(id, "a", "203.0.113.3"))
	if _, ok := first.next("welcome", 3*time.Second); !ok {
		t.Fatal("no welcome")
	}
	_ = first.ws.CloseNow()
	eventually(t, "a closed socket kept its place", func() bool {
		r.hub.addressMu.Lock()
		defer r.hub.addressMu.Unlock()
		return r.hub.addresses["203.0.113.3"] == 0
	})
	if _, ok := r.dialTicket(t, guestFrom(id, "b", "203.0.113.3")).next("welcome", 3*time.Second); !ok {
		t.Fatal("the place was not given back")
	}
}
