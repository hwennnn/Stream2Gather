package room

import "testing"

func TestPickUpOnReturn(t *testing.T) {
	video := []Item{{Media: Media{DurationMS: 600_000}}}
	tests := []struct {
		name     string
		playback Playback
		queue    []Item
		want     bool
	}{
		{"stopped when everyone left", Playback{Status: StatusPaused, ItemID: "a", Pos: 50}, video, true},
		{"unknown length", Playback{Status: StatusPaused, ItemID: "a", Pos: 50}, []Item{{}}, true},
		{"someone paused it", Playback{Status: StatusPaused, ItemID: "a", Pos: 50, PausedBy: "Ana"}, video, false},
		{"already playing", Playback{Status: StatusPlaying, ItemID: "a", Pos: 50}, video, false},
		{"nothing loaded", Playback{Status: StatusPaused}, nil, false},
		{"at the end", Playback{Status: StatusPaused, ItemID: "a", Pos: 598}, video, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state := State{Playback: test.playback, Queue: test.queue}
			if got := state.PickUpOnReturn(); got != test.want {
				t.Fatalf("PickUpOnReturn() = %v, want %v", got, test.want)
			}
		})
	}
}
