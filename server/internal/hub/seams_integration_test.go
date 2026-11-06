package hub

import (
	"context"
	"sync"
	"testing"
	"time"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// fakeRecorder keeps what it hears as short strings, in order.
type fakeRecorder struct {
	mu     sync.Mutex
	events []string
}

func (f *fakeRecorder) add(event string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, event)
}

func (f *fakeRecorder) count(event string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	total := 0
	for _, seen := range f.events {
		if seen == event {
			total++
		}
	}
	return total
}

func (f *fakeRecorder) waitFor(t *testing.T, event string, want int) {
	t.Helper()
	deadline := time.Now().Add(waitFor)
	for f.count(event) != want {
		if time.Now().After(deadline) {
			t.Fatalf("%s: got %d, want %d", event, f.count(event), want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func (f *fakeRecorder) Run(context.Context)             {}
func (f *fakeRecorder) Applied(_ string, s room.State)  { f.add("applied:" + s.Playback.Status) }
func (f *fakeRecorder) Joined(_ string, p store.Person) { f.add("joined:" + p.UserID) }
func (f *fakeRecorder) Left(_, userID string)           { f.add("left:" + userID) }
func (f *fakeRecorder) Moment(_ string, m Moment) {
	if m.Kind == MomentChat && m.MessageID == 0 {
		f.add("chat without a message")
	}
	f.add("moment:" + m.Kind + ":" + m.Author + ":" + m.Emoji)
}

func TestRecorderHearsTheRoom(t *testing.T) {
	recorder := &fakeRecorder{}
	r := newRig(t, testRedis, func(h *Hub) { h.recorder = recorder })
	roomID := r.newRoom(t, directVideo(t))

	first := r.joined(t, roomID, "u", room.RoleHost)
	second := r.joined(t, roomID, "u", room.RoleHost)
	recorder.waitFor(t, "joined:u", 2)

	first.send(t, "chat.send", map[string]any{"text": "hi"})
	first.send(t, "react", map[string]any{"emoji": "🔥"})
	first.send(t, room.CmdPlay, map[string]any{"item": "item1", "pos": 0, "version": 0})
	recorder.waitFor(t, "moment:chat:u:", 1)
	recorder.waitFor(t, "moment:reaction:u:🔥", 1)
	recorder.waitFor(t, "applied:playing", 1)
	if got := recorder.count("chat without a message"); got != 0 {
		t.Fatal("a chat moment lost its message")
	}

	// Closing one of two tabs is not the person leaving.
	_ = first.ws.CloseNow()
	time.Sleep(100 * time.Millisecond)
	recorder.waitFor(t, "left:u", 0)
	_ = second.ws.CloseNow()
	recorder.waitFor(t, "left:u", 1)
}
