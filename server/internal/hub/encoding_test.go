package hub

import (
	"encoding/json"
	"strings"
	"testing"

	"stream2gather/internal/room"
)

func decodeData(t *testing.T, body []byte) (string, map[string]json.RawMessage) {
	t.Helper()
	var envelope struct {
		Type string                     `json:"t"`
		Data map[string]json.RawMessage `json:"d"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Type, envelope.Data
}

// The client keeps its queue when the field is missing, which left the last
// video on screen after it ended.
func TestEmptyQueueIsAlwaysSentOnState(t *testing.T) {
	for _, queue := range [][]room.Item{nil, {}} {
		kind, data := decodeData(t, encodeChange(room.State{Queue: queue}, room.Change{Cause: "skip", Queue: true}))
		if kind != "state" || string(data["queue"]) != "[]" {
			t.Fatalf("queue %#v encoded as %s %s", queue, kind, data["queue"])
		}
	}
}

func TestPlaybackMessagesLeaveTheQueueOut(t *testing.T) {
	kind, data := decodeData(t, encodeChange(room.State{Queue: []room.Item{{ID: "a"}}}, room.Change{Cause: "pause"}))
	if _, present := data["queue"]; kind != "playback" || present {
		t.Fatalf("%s carries queue %s", kind, data["queue"])
	}
}

func TestSnapshotCarriesEverything(t *testing.T) {
	kind, data := decodeData(t, encodeSnapshot(room.New()))
	if kind != "state" || !strings.Contains(string(data["cause"]), causeSync) || data["settings"] == nil || data["queue"] == nil {
		t.Fatalf("snapshot = %s %v", kind, data)
	}
}
