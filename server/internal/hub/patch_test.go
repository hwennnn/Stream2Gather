package hub

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
	"testing"

	"stream2gather/internal/room"
)

// apply is what the client does with a patch.
func apply(t *testing.T, before []room.Item, patch *queuePatch) []room.Item {
	t.Helper()
	known := map[string]room.Item{}
	for _, item := range slices.Concat(before, patch.Items) {
		known[item.ID] = item
	}
	next := slices.Clone(before[:patch.At])
	for _, id := range patch.IDs {
		item, found := known[id]
		if !found {
			t.Fatalf("patch names %s, which the client can't have", id)
		}
		next = append(next, item)
	}
	next = append(next, before[patch.At+patch.Remove:]...)
	if len(next) != patch.Size {
		t.Fatalf("size %d, patch says %d", len(next), patch.Size)
	}
	return next
}

func items(ids ...string) []room.Item {
	out := make([]room.Item, len(ids))
	for i, id := range ids {
		out[i] = room.Item{ID: id}
	}
	return out
}

func TestAPatchRebuildsAnyQueue(t *testing.T) {
	random := rand.New(rand.NewPCG(1, 2))
	next := 0
	fresh := func() room.Item {
		next++
		return room.Item{ID: "new" + strconv.Itoa(next)}
	}
	for range 5000 {
		before := []room.Item{}
		for range random.IntN(12) {
			before = append(before, fresh())
		}
		after := slices.Clone(before)
		for range 1 + random.IntN(3) {
			switch at := random.IntN(len(after) + 1); {
			case random.IntN(3) == 0:
				after = slices.Insert(after, at, fresh())
			case len(after) == 0:
			case random.IntN(2) == 0:
				at = min(at, len(after)-1)
				after = slices.Delete(after, at, at+1)
			default:
				at = min(at, len(after)-1)
				moved := after[at]
				after = slices.Delete(after, at, at+1)
				after = slices.Insert(after, random.IntN(len(after)+1), moved)
			}
		}
		if got := apply(t, before, diffQueue(before, after)); !slices.Equal(got, after) {
			t.Fatalf("before %v after %v got %v", before, after, got)
		}
	}
}

func TestAPatchSendsOnlyItemsTheClientLacks(t *testing.T) {
	before := items("a", "b", "c")
	patch := diffQueue(before, items("c", "new", "a", "b"))
	if len(patch.Items) != 1 || patch.Items[0].ID != "new" {
		t.Fatalf("items = %+v", patch.Items)
	}
}

func TestAnItemChangedUnderItsIDIsSentAgain(t *testing.T) {
	before := items("a")
	after := []room.Item{{ID: "a", AddedByName: "Maya"}}
	if got := apply(t, before, diffQueue(before, after)); got[0].AddedByName != "Maya" {
		t.Fatalf("got %+v", got)
	}
}

func TestEmptyingTheQueueSaysSo(t *testing.T) {
	kind, data := decodeData(t, encodeApplied(items("a"), room.State{}, room.Change{Cause: "skip", Queue: true}))
	var patch queuePatch
	if err := json.Unmarshal(data["patch"], &patch); err != nil || kind != "state" {
		t.Fatalf("%s %s %v", kind, data["patch"], err)
	}
	if patch.Size != 0 || patch.Remove != 1 || patch.IDs == nil {
		t.Fatalf("patch = %+v", patch)
	}
	if !strings.Contains(string(data["patch"]), `"ids":[]`) {
		t.Fatalf("a client can't map over %s", data["patch"])
	}
}

func TestSettingsLeaveTheQueueOut(t *testing.T) {
	state := room.State{Queue: items("a")}
	_, data := decodeData(t, encodeApplied(state.Queue, state, room.Change{Cause: "settings", Settings: true}))
	if data["queue"] != nil || data["patch"] != nil || data["settings"] == nil {
		t.Fatalf("settings carried %v", data)
	}
}
