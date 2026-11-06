package hub

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"stream2gather/internal/room"
)

func chats(t *testing.T, c *client, count int) {
	t.Helper()
	for i := range count {
		c.sendWithID(t, fmt.Sprint("m", i), "chat.send", map[string]string{"text": "hello"})
	}
}

// count drains frames for a moment and says how many were of this kind.
func count(c *client, kind string, d time.Duration) int {
	found := 0
	for {
		if _, ok := c.next(kind, d); !ok {
			return found
		}
		found++
	}
}

func TestTabsShareOnePersonsLimit(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	tabs := []*client{r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember)}
	for _, tab := range tabs {
		chats(t, tab, 5)
	}
	accepted := 0
	for _, tab := range tabs {
		accepted += count(tab, "ack", 300*time.Millisecond)
	}
	// A burst of five, and whatever the bucket refilled while the test ran.
	if accepted > 7 {
		t.Fatalf("%d of 15 messages accepted: more tabs bought more of the limit", accepted)
	}
}

func TestTabsShareOnePersonsVoiceLimit(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	tabs := []*client{r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember)}
	for _, tab := range tabs {
		for i := range 10 {
			tab.sendWithID(t, fmt.Sprint("v", i), "voice", map[string]string{"state": "muted"})
		}
	}
	accepted := 0
	for _, tab := range tabs {
		accepted += count(tab, "ack", 300*time.Millisecond)
	}
	if accepted < 10 {
		t.Fatalf("%d of 30 voice changes accepted: fewer than one burst", accepted)
	}
	// A burst of ten, and whatever the bucket refilled while the test ran.
	if accepted > 14 {
		t.Fatalf("%d of 30 voice changes accepted: more tabs bought more of the limit", accepted)
	}
}

func TestReconnectingDoesNotRefillALimit(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	r.joined(t, id, "other", room.RoleMember) // Keeps the room open here.

	first := r.joined(t, id, "u", room.RoleMember)
	chats(t, first, 5)
	if got := count(first, "ack", 200*time.Millisecond); got != 5 {
		t.Fatalf("%d acks", got)
	}
	_ = first.ws.CloseNow()

	second := r.joined(t, id, "u", room.RoleMember)
	chats(t, second, 5)
	if got := count(second, "ack", 200*time.Millisecond); got > 2 {
		t.Fatalf("%d messages accepted straight after reconnecting", got)
	}
}

func TestOnePersonsLimitIsNotAnothers(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	spammer := r.joined(t, id, "spammer", room.RoleMember)
	chats(t, spammer, 20)
	neighbour := r.joined(t, id, "neighbour", room.RoleMember)
	chats(t, neighbour, 1)
	neighbour.expect(t, "ack")
}

func TestStatusUpdatesCannotCostAPause(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)
	for range 40 {
		c.send(t, "status", map[string]any{"state": "buffering"})
	}
	c.sendWithID(t, "p", room.CmdPause, map[string]any{"item": "item1", "pos": 1, "ct": time.Now().UnixMilli()})
	c.expectWhere(t, "ack", func(data json.RawMessage) bool { return strings.Contains(string(data), `"p"`) })
}

func TestPingsCannotFloodRedis(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)
	for range 200 {
		c.send(t, "ping", map[string]any{"t0": 1})
	}
	if got := count(c, "pong", 300*time.Millisecond); got > 15 {
		t.Fatalf("%d pongs for 200 pings", got)
	}
}

func TestAClientsOpeningPingsAreAllAnswered(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)
	for range 5 {
		c.send(t, "ping", map[string]any{"t0": 1})
	}
	if got := count(c, "pong", 300*time.Millisecond); got != 5 {
		t.Fatalf("%d pongs for the opening five", got)
	}
}
