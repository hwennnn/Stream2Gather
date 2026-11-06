package hub

import (
	"context"
	"testing"
	"time"

	"stream2gather/internal/ids"
	"stream2gather/internal/store"
)

func accountTicket(roomID, userID string, version int64) store.Ticket {
	return store.Ticket{
		RoomID: roomID, RoomSlug: roomID, Account: true, SessionVersion: version,
		Person: store.Person{UserID: userID, Name: userID},
	}
}

func fastSessionChecks(h *Hub) { h.sessionCheck = 20 * time.Millisecond }

func TestSignOutEndsOpenSockets(t *testing.T) {
	r := newRig(t, testRedis, fastSessionChecks)
	id := r.newRoom(t, directVideo(t))
	user := "u_" + ids.New()
	c := r.dialTicket(t, accountTicket(id, user, 0))
	c.expect(t, "welcome")

	if err := r.db.BumpSessionVersion(context.Background(), user); err != nil {
		t.Fatal(err)
	}

	select {
	case code := <-c.closed:
		if code != statusSignedOut {
			t.Fatalf("closed with %d", code)
		}
	case <-time.After(waitFor):
		t.Fatal("the socket outlived the session")
	}
}

func TestATicketTakenBeforeSignOutCannotOpenASocketThatLasts(t *testing.T) {
	r := newRig(t, testRedis, fastSessionChecks)
	id := r.newRoom(t, directVideo(t))
	user := "u_" + ids.New()
	if err := r.db.EnsureUser(context.Background(), user, user); err != nil {
		t.Fatal(err)
	}
	if err := r.db.BumpSessionVersion(context.Background(), user); err != nil {
		t.Fatal(err)
	}

	c := r.dialTicket(t, accountTicket(id, user, 0))
	select {
	case <-c.closed:
	case <-time.After(waitFor):
		t.Fatal("a socket from before sign-out stayed open")
	}
}

func TestSignOutLeavesEveryoneElseConnected(t *testing.T) {
	r := newRig(t, testRedis, fastSessionChecks)
	id := r.newRoom(t, directVideo(t))
	leaving, staying := "u_"+ids.New(), "u_"+ids.New()
	gone := r.dialTicket(t, accountTicket(id, leaving, 0))
	gone.expect(t, "welcome")
	account := r.dialTicket(t, accountTicket(id, staying, 0))
	account.expect(t, "welcome")
	guest := r.joined(t, id, "g_"+ids.New(), "member")

	if err := r.db.BumpSessionVersion(context.Background(), leaving); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gone.closed:
	case <-time.After(waitFor):
		t.Fatal("the socket outlived the session")
	}

	time.Sleep(100 * time.Millisecond)
	select {
	case code := <-account.closed:
		t.Fatalf("another account was closed with %d", code)
	case code := <-guest.closed:
		t.Fatalf("a guest was closed with %d", code)
	default:
	}
}
