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

// replies waits for an answer to each of n messages, and says how many were
// accepted. It has no window of its own to miss, however slow the machine.
func replies(t *testing.T, c *client, n int) int {
	t.Helper()
	accepted := 0
	for answered := 0; answered < n; {
		select {
		case message := <-c.in:
			switch message.T {
			case "ack":
				accepted++
				answered++
			case "error":
				answered++
			}
		case <-time.After(waitFor):
			t.Fatalf("%d of %d messages answered", answered, n)
		}
	}
	return accepted
}

func TestTabsShareOnePersonsLimit(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	tabs := []*client{r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember)}
	started := time.Now()
	for _, tab := range tabs {
		chats(t, tab, 5)
	}
	accepted := 0
	for _, tab := range tabs {
		accepted += replies(t, tab, 5)
	}
	// A burst of five, and two a second refilled while the test ran.
	if most := 5 + int(2*time.Since(started).Seconds()); accepted > most {
		t.Fatalf("%d of 15 messages accepted, and the limit allows %d: more tabs bought more of it", accepted, most)
	}
}

func TestTabsShareOnePersonsVoiceLimit(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	tabs := []*client{r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember), r.joined(t, id, "u", room.RoleMember)}
	started := time.Now()
	for _, tab := range tabs {
		for i := range 10 {
			tab.sendWithID(t, fmt.Sprint("v", i), "voice", map[string]string{"state": "muted"})
		}
	}
	accepted := 0
	for _, tab := range tabs {
		accepted += replies(t, tab, 10)
	}
	if accepted < 10 {
		t.Fatalf("%d of 30 voice changes accepted: fewer than one burst", accepted)
	}
	// A burst of ten, and five a second refilled while the test ran.
	if most := 10 + int(5*time.Since(started).Seconds()); accepted > most {
		t.Fatalf("%d of 30 voice changes accepted, and the limit allows %d: more tabs bought more of it", accepted, most)
	}
}

func TestReconnectingDoesNotRefillALimit(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	r.joined(t, id, "other", room.RoleMember) // Keeps the room open here.

	first := r.joined(t, id, "u", room.RoleMember)
	started := time.Now()
	chats(t, first, 5)
	accepted := replies(t, first, 5)
	_ = first.ws.CloseNow()

	second := r.joined(t, id, "u", room.RoleMember)
	chats(t, second, 5)
	accepted += replies(t, second, 5)

	// The bucket holds five and refills at two a second, so this is a limit however
	// long the test took. Fresh limits for the new socket would accept all ten.
	if most := 5 + int(2*time.Since(started).Seconds()); accepted > most {
		t.Fatalf("%d messages accepted, and the limit allows %d", accepted, most)
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
	started := time.Now()
	for range 200 {
		c.send(t, "ping", map[string]any{"t0": 1})
	}
	got := count(c, "pong", 300*time.Millisecond)
	// A burst of ten, and two a second refilled while the test ran.
	if most := 10 + int(2*time.Since(started).Seconds()); got > most {
		t.Fatalf("%d pongs for 200 pings, and the limit allows %d", got, most)
	}
}

func TestAClientsOpeningPingsAreAllAnswered(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)
	for range 5 {
		c.send(t, "ping", map[string]any{"t0": 1})
	}
	for range 5 {
		c.expect(t, "pong")
	}
}
