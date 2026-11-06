package hub

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

func quickPings(h *Hub) { h.pingEvery = 30 * time.Millisecond }

func TestSomeoneWhoStoppedAnsweringLeavesTheRoom(t *testing.T) {
	r := newRig(t, testRedis, quickPings)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	if err := r.db.EnsureUser(ctx, "asleep", "asleep"); err != nil {
		t.Fatal(err)
	}
	ticket, _ := json.Marshal(store.Ticket{RoomID: id, RoomSlug: id, Person: store.Person{UserID: "asleep", Name: "asleep"}})
	address := "ws" + strings.TrimPrefix(r.server.URL, "http") + "?ticket=" + url.QueryEscape(string(ticket))

	// Nothing reads this socket, so nothing answers its pings: a machine gone to sleep.
	ws, _, err := websocket.Dial(ctx, address, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	eventually(t, "never joined", func() bool {
		people, err := r.live.People(ctx, id)
		return err == nil && len(people) == 1
	})
	eventually(t, "still listed long after going silent", func() bool {
		people, err := r.live.People(ctx, id)
		return err == nil && len(people) == 0
	})
}

func TestSomeoneAnsweringStaysInTheRoom(t *testing.T) {
	r := newRig(t, testRedis, func(h *Hub) { h.pingEvery = time.Second })
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "awake", room.RoleMember)
	time.Sleep(2500 * time.Millisecond)
	select {
	case code := <-c.closed:
		t.Fatalf("closed with %d while answering every ping", code)
	default:
	}
}
