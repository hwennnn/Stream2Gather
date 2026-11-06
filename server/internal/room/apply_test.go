package room

import (
	"errors"
	"fmt"
	"testing"
)

const now = int64(1_000_000)

var (
	host   = Actor{ID: "h", Name: "Host", Role: RoleHost}
	member = Actor{ID: "m", Name: "Member", Role: RoleMember}
)

func add(t *testing.T, s State, id string, durationMS int64) State {
	t.Helper()
	next, _, err := Apply(s, member, Command{
		Type:      CmdQueueAdd,
		NewItemID: id,
		Media:     &Media{Source: "youtube", SourceID: id, DurationMS: durationMS},
	}, now)
	if err != nil {
		t.Fatalf("add %s: %v", id, err)
	}
	return next
}

func TestFirstVideoStartsTogetherInTheFuture(t *testing.T) {
	s := add(t, New(), "a", 0)
	if s.Playback.ItemID != "a" || s.Playback.Status != StatusPlaying {
		t.Fatalf("playback = %+v", s.Playback)
	}
	if s.Playback.At != now+StartLeadMS {
		t.Fatalf("at = %d, want a shared future start", s.Playback.At)
	}
	if got := s.Playback.Position(now); got != 0 {
		t.Fatalf("position before start = %v", got)
	}
}

func TestPositionAdvancesWithRate(t *testing.T) {
	p := Playback{Status: StatusPlaying, Pos: 10, At: now, Rate: 2}
	if got := p.Position(now + 1500); got != 13 {
		t.Fatalf("position = %v, want 13", got)
	}
	p.Status = StatusPaused
	if got := p.Position(now + 1500); got != 10 {
		t.Fatalf("paused position = %v, want 10", got)
	}
}

func TestStaleTransportIsRejected(t *testing.T) {
	s := add(t, add(t, New(), "a", 0), "b", 0)
	next, _, err := Apply(s, member, Command{Type: CmdSkip, Item: "a"}, now)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = Apply(next, member, Command{Type: CmdSeek, Item: "a", Pos: 30, CT: now}, now)
	if !errors.Is(err, ErrStale) {
		t.Fatalf("late seek err = %v, want ErrStale", err)
	}
}

func TestClientTimeIsClamped(t *testing.T) {
	s := add(t, New(), "a", 0)
	tests := []struct {
		name string
		ct   int64
		want int64
	}{
		{"recent time is kept", now - 100, now - 100},
		{"old time is limited", now - 60_000, now - maxClientSkewMS},
		{"future time is limited", now + 60_000, now},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			next, _, err := Apply(s, member, Command{Type: CmdSeek, Item: "a", Pos: 5, CT: test.ct}, now)
			if err != nil {
				t.Fatal(err)
			}
			if next.Playback.At != test.want {
				t.Fatalf("at = %d, want %d", next.Playback.At, test.want)
			}
		})
	}
}

func TestEndedOnlyCountsNearTheEndAndOnce(t *testing.T) {
	s := add(t, add(t, New(), "a", 60_000), "b", 0)

	if _, _, err := Apply(s, member, Command{Type: CmdEnded, Item: "a"}, now); !errors.Is(err, ErrStale) {
		t.Fatalf("early ended err = %v, want ErrStale", err)
	}

	late := now + StartLeadMS + 58_000
	next, _, err := Apply(s, member, Command{Type: CmdEnded, Item: "a"}, late)
	if err != nil {
		t.Fatal(err)
	}
	if next.Playback.ItemID != "b" {
		t.Fatalf("current = %q, want b", next.Playback.ItemID)
	}
	if _, _, err := Apply(next, member, Command{Type: CmdEnded, Item: "a"}, late); !errors.Is(err, ErrStale) {
		t.Fatalf("duplicate ended err = %v, want ErrStale", err)
	}
}

func TestLastVideoEndingIdlesTheRoom(t *testing.T) {
	s := add(t, New(), "a", 0)
	next, _, err := Apply(s, member, Command{Type: CmdSkip, Item: "a"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if next.Playback.Status != StatusIdle || len(next.Queue) != 0 {
		t.Fatalf("state = %+v", next)
	}
}

func TestQueueOperationsUseItemIDs(t *testing.T) {
	s := New()
	for _, id := range []string{"a", "b", "c", "d"} {
		s = add(t, s, id, 0)
	}

	moved, _, err := Apply(s, member, Command{Type: CmdQueueMove, Target: "d", Index: 1}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(moved); got != "a d b c" {
		t.Fatalf("after move = %s", got)
	}

	removed, _, err := Apply(moved, member, Command{Type: CmdQueueRemove, Target: "b"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(removed); got != "a d c" {
		t.Fatalf("after remove = %s", got)
	}

	if _, _, err := Apply(removed, member, Command{Type: CmdQueueRemove, Target: "b"}, now); !errors.Is(err, ErrStale) {
		t.Fatalf("second remove err = %v, want ErrStale", err)
	}

	played, _, err := Apply(removed, member, Command{Type: CmdQueuePlay, Target: "c"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(played); got != "c d" || played.Playback.ItemID != "c" {
		t.Fatalf("after play = %s, current %s", got, played.Playback.ItemID)
	}

	cleared, _, err := Apply(played, member, Command{Type: CmdQueueClear}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(cleared); got != "c" {
		t.Fatalf("after clear = %s", got)
	}
}

func TestRemovingCurrentVideoAdvances(t *testing.T) {
	s := add(t, add(t, New(), "a", 0), "b", 0)
	next, change, err := Apply(s, member, Command{Type: CmdQueueRemove, Target: "a"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if next.Playback.ItemID != "b" || !change.Playback {
		t.Fatalf("current = %q, playback changed = %v", next.Playback.ItemID, change.Playback)
	}
}

func TestHostOnlyModes(t *testing.T) {
	s := add(t, New(), "a", 0)
	s, _, err := Apply(s, host, Command{
		Type:     CmdSettings,
		Settings: &Settings{ControlMode: ModeHosts, QueueMode: ModeHosts},
	}, now)
	if err != nil {
		t.Fatal(err)
	}

	blocked := []Command{
		{Type: CmdPause, Item: "a", CT: now},
		{Type: CmdSkip, Item: "a"},
		{Type: CmdQueueClear},
		{Type: CmdQueueAdd, NewItemID: "x", Media: &Media{}},
	}
	for _, cmd := range blocked {
		if _, _, err := Apply(s, member, cmd, now); !errors.Is(err, ErrForbidden) {
			t.Errorf("%s err = %v, want ErrForbidden", cmd.Type, err)
		}
		if _, _, err := Apply(s, host, cmd, now); err != nil {
			t.Errorf("host %s err = %v", cmd.Type, err)
		}
	}

	if _, _, err := Apply(s, member, Command{Type: CmdSettings, Settings: &s.Settings}, now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member settings err = %v", err)
	}
}

func TestSystemActorBypassesModes(t *testing.T) {
	s := add(t, New(), "a", 0)
	s.Settings.ControlMode = ModeHosts
	if _, _, err := Apply(s, Actor{System: true}, Command{Type: CmdSkip, Item: "a"}, now); err != nil {
		t.Fatal(err)
	}
}

func TestRejectedCommandDoesNotTouchInput(t *testing.T) {
	s := add(t, add(t, New(), "a", 0), "b", 0)
	version := s.Version
	if _, _, err := Apply(s, member, Command{Type: "nope"}, now); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v", err)
	}
	if s.Version != version || ids(s) != "a b" {
		t.Fatalf("input changed: %+v", s)
	}
}

func TestApplyDoesNotShareQueueWithInput(t *testing.T) {
	s := add(t, add(t, add(t, New(), "a", 0), "b", 0), "c", 0)
	if _, _, err := Apply(s, member, Command{Type: CmdQueueMove, Target: "c", Index: 1}, now); err != nil {
		t.Fatal(err)
	}
	if ids(s) != "a b c" {
		t.Fatalf("input queue changed: %s", ids(s))
	}
}

func TestQueueIsBounded(t *testing.T) {
	s := New()
	for i := range maxQueue {
		s = add(t, s, fmt.Sprint(i), 0)
	}
	_, _, err := Apply(s, member, Command{Type: CmdQueueAdd, NewItemID: "x", Media: &Media{}}, now)
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("err = %v", err)
	}
}

func ids(s State) string {
	out := ""
	for i, item := range s.Queue {
		if i > 0 {
			out += " "
		}
		out += item.ID
	}
	return out
}
