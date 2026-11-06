package room

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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
}

func jumped(t *testing.T) State {
	t.Helper()
	s := add(t, add(t, add(t, add(t, New(), "a", 0), "b", 0), "c", 0), "d", 0)
	s, _, err := Apply(s, member, Command{Type: CmdPause, Item: "a", Pos: 42, CT: now}, now)
	if err != nil {
		t.Fatal(err)
	}
	s, _, err = Apply(s, member, Command{Type: CmdPlay, Item: "a", Pos: 42, CT: now}, now)
	if err != nil {
		t.Fatal(err)
	}
	s, _, err = Apply(s, member, Command{Type: CmdQueuePlay, Target: "c"}, now+10_000)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestUndoPutsTheRoomBackAsItWas(t *testing.T) {
	s := jumped(t)
	if got := ids(s); got != "c b d" {
		t.Fatalf("after jump = %s", got)
	}
	back, change, err := Apply(s, member, Command{Type: CmdQueueUndo, Target: "c"}, now+12_000)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(back); got != "a b c d" {
		t.Fatalf("after undo = %s", got)
	}
	if !change.Queue || change.By != member.Name {
		t.Fatalf("change = %+v", change)
	}
	p := back.Playback
	if p.ItemID != "a" || p.Status != StatusPlaying || p.Pos != 52 || p.At != now+12_000+StartLeadMS {
		t.Fatalf("playback = %+v, want a resuming at 52 after the start lead", p)
	}
	if back.Jump != nil {
		t.Fatal("a jump can only be undone once")
	}
}

func TestUndoKeepsAPausedVideoPaused(t *testing.T) {
	s := add(t, add(t, New(), "a", 0), "b", 0)
	s, _, err := Apply(s, member, Command{Type: CmdPause, Item: "a", Pos: 42, CT: now}, now)
	if err != nil {
		t.Fatal(err)
	}
	s, _, err = Apply(s, member, Command{Type: CmdQueuePlay, Target: "b"}, now+60_000)
	if err != nil {
		t.Fatal(err)
	}
	back, _, err := Apply(s, member, Command{Type: CmdQueueUndo, Target: "b"}, now+61_000)
	if err != nil {
		t.Fatal(err)
	}
	if p := back.Playback; p.Status != StatusPaused || p.Pos != 42 {
		t.Fatalf("playback = %+v", p)
	}
}

func TestUndoIsRefusedOnceTheMomentHasPassed(t *testing.T) {
	s := jumped(t)
	late := Command{Type: CmdQueueUndo, Target: "c"}
	if _, _, err := Apply(s, member, late, now+10_000+undoWindowMS+1); !errors.Is(err, ErrStale) {
		t.Fatalf("late undo err = %v", err)
	}
	if _, _, err := Apply(s, member, Command{Type: CmdQueueUndo, Target: "b"}, now+11_000); !errors.Is(err, ErrStale) {
		t.Fatalf("undo of another video err = %v", err)
	}
	skipped, _, err := Apply(s, member, Command{Type: CmdSkip, Item: "c"}, now+11_000)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := Apply(skipped, member, late, now+11_000); !errors.Is(err, ErrStale) {
		t.Fatalf("undo after a skip err = %v", err)
	}
}

func TestUndoSurvivesTheQueueChangingUnderIt(t *testing.T) {
	s := jumped(t)
	s, _, err := Apply(s, member, Command{Type: CmdQueueRemove, Target: "d"}, now+11_000)
	if err != nil {
		t.Fatal(err)
	}
	s, _, err = Apply(s, member, Command{Type: CmdQueueRemove, Target: "b"}, now+11_000)
	if err != nil {
		t.Fatal(err)
	}
	back, _, err := Apply(s, member, Command{Type: CmdQueueUndo, Target: "c"}, now+12_000)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(back); got != "a c" {
		t.Fatalf("after undo = %s", got)
	}
}

func TestUndoNeedsTheRightToControlPlayback(t *testing.T) {
	s := jumped(t)
	s.Settings.ControlMode = ModeHosts
	if _, _, err := Apply(s, member, Command{Type: CmdQueueUndo, Target: "c"}, now+11_000); !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v", err)
	}
}

func TestRemovingCurrentVideoAdvances(t *testing.T) {
	s := add(t, add(t, New(), "a", 0), "b", 0)
	next, change, err := Apply(s, member, Command{Type: CmdQueueRemove, Target: "a"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if next.Playback.ItemID != "b" || !change.Queue {
		t.Fatalf("current = %q, queue changed = %v", next.Playback.ItemID, change.Queue)
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

// A real browser's ct is often fractional, and rejecting it lost the command.
func TestFractionalClientTimeDecodes(t *testing.T) {
	var cmd Command
	body := `{"item":"a","pos":3.2,"ct":1793000000000.5}`
	if err := json.Unmarshal([]byte(body), &cmd); err != nil {
		t.Fatal(err)
	}
	if cmd.CT != 1793000000001 || cmd.Item != "a" || cmd.Pos != 3.2 {
		t.Fatalf("decoded %+v", cmd)
	}
}

func locked(s State) State {
	s.Settings = Settings{ControlMode: ModeHosts, QueueMode: ModeHosts}
	return s
}

func controlLocked(s State) State {
	s.Settings = Settings{ControlMode: ModeHosts, QueueMode: ModeEveryone}
	return s
}

func TestHostOnlyModeCannotBeWalkedAround(t *testing.T) {
	media := &Media{Source: "youtube", SourceID: "n"}
	cases := []struct {
		name  string
		state State
		cmd   Command
	}{
		{"ended with no known duration", controlLocked(add(t, New(), "a", 0)), Command{Type: CmdEnded, Item: "a"}},
		{"playing something now", controlLocked(add(t, New(), "a", 0)), Command{Type: CmdQueueAdd, Mode: AddNow, Media: media, NewItemID: "n"}},
		{"removing the current video", controlLocked(add(t, add(t, New(), "a", 0), "b", 0)), Command{Type: CmdQueueRemove, Target: "a"}},
		{"adding at all", locked(add(t, New(), "a", 0)), Command{Type: CmdQueueAdd, Media: media, NewItemID: "n"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if _, _, err := Apply(test.state, member, test.cmd, now); !errors.Is(err, ErrForbidden) {
				t.Fatalf("member got %v", err)
			}
			if _, _, err := Apply(test.state, host, test.cmd, now); err != nil && test.name != "adding at all" {
				t.Fatalf("host got %v", err)
			}
		})
	}
}

func TestQueuePermissionAloneStillCoversTheQueue(t *testing.T) {
	s := controlLocked(add(t, add(t, New(), "a", 0), "b", 0))
	if _, _, err := Apply(s, member, Command{Type: CmdQueueRemove, Target: "b"}, now); err != nil {
		t.Fatalf("removing an upcoming video: %v", err)
	}
	media := &Media{Source: "youtube", SourceID: "n"}
	if _, _, err := Apply(s, member, Command{Type: CmdQueueAdd, Mode: AddNext, Media: media, NewItemID: "n"}, now); err != nil {
		t.Fatalf("adding next: %v", err)
	}
	empty := controlLocked(New())
	if _, _, err := Apply(empty, member, Command{Type: CmdQueueAdd, Mode: AddNow, Media: media, NewItemID: "n"}, now); err != nil {
		t.Fatalf("nothing is displaced in an empty room: %v", err)
	}
}

func TestEndedNearAKnownEndNeedsNoPermission(t *testing.T) {
	s := controlLocked(add(t, New(), "a", 60_000))
	if _, _, err := Apply(s, member, Command{Type: CmdEnded, Item: "a"}, now+StartLeadMS+59_000); err != nil {
		t.Fatal(err)
	}
}

func TestQueueAddModes(t *testing.T) {
	media := &Media{Source: "youtube", SourceID: "n"}
	s := add(t, add(t, New(), "a", 0), "b", 0)
	cases := []struct {
		mode, want, current string
	}{
		{AddEnd, "a b n", "a"},
		{"", "a b n", "a"},
		{AddNext, "a n b", "a"},
		{AddNow, "n a b", "n"},
	}
	for _, test := range cases {
		next, _, err := Apply(s, member, Command{Type: CmdQueueAdd, Mode: test.mode, Media: media, NewItemID: "n"}, now)
		if err != nil {
			t.Fatalf("mode %q: %v", test.mode, err)
		}
		if got := ids(next); got != test.want || next.Playback.ItemID != test.current {
			t.Fatalf("mode %q: queue %s, current %s", test.mode, got, next.Playback.ItemID)
		}
	}
	if _, _, err := Apply(s, member, Command{Type: CmdQueueAdd, Mode: "sideways", Media: media, NewItemID: "n"}, now); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown mode: %v", err)
	}
}

func TestLockReleaseAndRestore(t *testing.T) {
	system := Actor{System: true}
	s := controlLocked(add(t, New(), "a", 0))

	released, change, err := Apply(s, system, Command{Type: CmdRelease}, now)
	if err != nil {
		t.Fatal(err)
	}
	if released.Settings.Locked() || released.Held == nil || !change.Settings {
		t.Fatalf("released = %+v", released)
	}
	if _, _, err := Apply(released, member, Command{Type: CmdSkip, Item: "a"}, now); err != nil {
		t.Fatalf("anyone can control a released room: %v", err)
	}
	if _, _, err := Apply(released, system, Command{Type: CmdRelease}, now); !errors.Is(err, ErrStale) {
		t.Fatalf("second server releasing: %v", err)
	}

	restored, _, err := Apply(released, system, Command{Type: CmdRestore}, now)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Settings != s.Settings || restored.Held != nil {
		t.Fatalf("restored = %+v", restored)
	}
	if _, _, err := Apply(restored, system, Command{Type: CmdRestore}, now); !errors.Is(err, ErrStale) {
		t.Fatalf("second server restoring: %v", err)
	}

	for _, kind := range []string{CmdRelease, CmdRestore} {
		if _, _, err := Apply(s, host, Command{Type: kind}, now); !errors.Is(err, ErrForbidden) {
			t.Fatalf("%s from a person: %v", kind, err)
		}
	}
}

func TestReleaseLeavesAnOpenRoomAlone(t *testing.T) {
	if _, _, err := Apply(add(t, New(), "a", 0), Actor{System: true}, Command{Type: CmdRelease}, now); !errors.Is(err, ErrStale) {
		t.Fatalf("got %v", err)
	}
}

func TestCleanName(t *testing.T) {
	for raw, want := range map[string]string{"  Maya ": "Maya", "Zoë 🎬": "Zoë 🎬"} {
		if got, ok := CleanName(raw); !ok || got != want {
			t.Fatalf("CleanName(%q) = %q, %v", raw, got, ok)
		}
	}
	for _, raw := range []string{"", "   ", "a\x00b", "a\nb", "a\tb", "\x7f", strings.Repeat("x", 33), "a\xffb"} {
		if got, ok := CleanName(raw); ok {
			t.Fatalf("CleanName(%q) accepted as %q", raw, got)
		}
	}
}

func TestPositionAtStopsAtTheEnd(t *testing.T) {
	state := New()
	state.Playback = Playback{ItemID: "a", Status: StatusPlaying, At: 0, Rate: 1}
	state.Queue = []Item{{ID: "a", Media: Media{DurationMS: 600_000}}}
	if pos := state.PositionAt(100_000); pos != 100 {
		t.Fatalf("pos = %v", pos)
	}
	if pos := state.PositionAt(3_700_000); pos != 600 {
		t.Fatalf("pos = %v, want the end of the video", pos)
	}
	state.Queue[0].DurationMS = 0
	if pos := state.PositionAt(3_700_000); pos != 3700 {
		t.Fatalf("unknown length: pos = %v", pos)
	}
}

func TestRestedStopsAtTheSaveTime(t *testing.T) {
	state := New()
	state.Playback = Playback{ItemID: "a", Status: StatusPlaying, At: 0, Rate: 1}
	rested := state.Rested(50_000, 900_000)
	if rested.Playback.Status != StatusPaused || rested.Playback.Pos != 50 || rested.Playback.At != 900_000 {
		t.Fatalf("playback = %+v", rested.Playback)
	}
	state.Playback.Status = StatusPaused
	state.Playback.Pos = 12
	if rested := state.Rested(50_000, 900_000); rested.Playback != state.Playback {
		t.Fatalf("a paused room moved: %+v", rested.Playback)
	}
}
