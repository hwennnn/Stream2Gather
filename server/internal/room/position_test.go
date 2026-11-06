package room

import (
	"errors"
	"testing"
)

func TestAnAbsurdPositionIsRefused(t *testing.T) {
	for _, duration := range []int64{0, 212_000} {
		s := add(t, New(), "a", duration)
		for _, kind := range []string{CmdPlay, CmdPause, CmdSeek} {
			for _, pos := range []float64{1e308, maxPositionSeconds + 1, -1} {
				_, _, err := Apply(s, member, Command{Type: kind, Item: "a", Pos: pos, CT: now}, now)
				if !errors.Is(err, ErrInvalid) {
					t.Errorf("%s to %g with duration %d: err = %v, want ErrInvalid", kind, pos, duration, err)
				}
			}
		}
	}
}

func TestAPositionWithNoKnownEndIsKept(t *testing.T) {
	s := add(t, New(), "live", 0)
	next, _, err := Apply(s, member, Command{Type: CmdPause, Item: "live", Pos: 90_000, CT: now}, now)
	if err != nil {
		t.Fatal(err)
	}
	if next.Playback.Pos != 90_000 {
		t.Fatalf("pos = %g", next.Playback.Pos)
	}
}

func TestAReportPastTheEndIsTheEnd(t *testing.T) {
	s := add(t, New(), "a", 212_000)
	next, _, err := Apply(s, member, Command{Type: CmdPause, Item: "a", Pos: 212.4, CT: now}, now)
	if err != nil {
		t.Fatalf("a pause just past the end was lost: %v", err)
	}
	if next.Playback.Pos != 212 {
		t.Fatalf("pos = %g, want the end", next.Playback.Pos)
	}
}
