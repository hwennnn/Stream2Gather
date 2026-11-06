package hub

import (
	"encoding/json"
	"testing"

	"stream2gather/internal/room"
)

// voiceOf reads a member's voice state from a members event.
func voiceOf(t *testing.T, data json.RawMessage, userID string) (string, bool) {
	t.Helper()
	var event struct {
		Members []struct {
			UserID string `json:"userId"`
			Voice  string `json:"voice"`
		} `json:"members"`
	}
	if err := json.Unmarshal(data, &event); err != nil {
		t.Fatal(err)
	}
	for _, member := range event.Members {
		if member.UserID == userID {
			return member.Voice, true
		}
	}
	return "", false
}

func expectVoice(t *testing.T, c *client, userID, want string) {
	t.Helper()
	c.expectWhere(t, "members", func(data json.RawMessage) bool {
		got, found := voiceOf(t, data, userID)
		return found && got == want
	})
}

func TestVoiceStateReachesTheRoom(t *testing.T) {
	r := newRig(t, testRedis)
	roomID := r.newRoom(t, directVideo(t))
	talker := r.joined(t, roomID, "talker", room.RoleMember)
	watcher := r.joined(t, roomID, "watcher", room.RoleMember)

	for state, shown := range map[string]string{"listening": "listening", "muted": "muted", "live": "live"} {
		talker.sendWithID(t, "1", "voice", map[string]any{"state": state})
		expectVoice(t, watcher, "talker", shown)
		talker.expect(t, "ack")
	}
	talker.send(t, "voice", map[string]any{"state": "off"})
	expectVoice(t, watcher, "talker", "")
}

func TestVoiceStateRefusesWhatItDoesNotKnow(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	c.sendWithID(t, "3", "voice", map[string]any{"state": "shouting"})
	failure := c.expect(t, "error")
	var problem struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(failure.D, &problem); err != nil || problem.Code != "invalid" {
		t.Fatalf("got %s", failure.D)
	}
}

func TestOnlyTheTabInTheCallDecidesTheVoiceState(t *testing.T) {
	r := newRig(t, testRedis)
	roomID := r.newRoom(t, directVideo(t))
	call := r.joined(t, roomID, "u", room.RoleMember)
	other := r.joined(t, roomID, "u", room.RoleMember)
	watcher := r.joined(t, roomID, "watcher", room.RoleMember)

	call.send(t, "voice", map[string]any{"state": "live"})
	expectVoice(t, watcher, "u", "live")

	// Closing the other tab must not take them out of the call.
	_ = other.ws.CloseNow()
	expectVoice(t, watcher, "u", "live")

	_ = call.ws.CloseNow()
	watcher.expectWhere(t, "members", func(data json.RawMessage) bool {
		_, found := voiceOf(t, data, "u")
		return !found
	})
}

func TestVoiceChangesCannotCostAPause(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleHost)
	for i := range 40 {
		state := "muted"
		if i%2 == 0 {
			state = "live"
		}
		c.send(t, "voice", map[string]any{"state": state})
	}
	c.sendWithID(t, "play", room.CmdPlay, map[string]any{"item": "item1", "pos": 0, "version": 0})
	c.expectWhere(t, "ack", func(data json.RawMessage) bool {
		var ack struct {
			ID string `json:"id"`
		}
		return json.Unmarshal(data, &ack) == nil && ack.ID == "play"
	})
}
