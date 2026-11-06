package room

import (
	"encoding/json"
	"math"
	"slices"
)

// Command types.
const (
	CmdPlay        = "play"
	CmdPause       = "pause"
	CmdSeek        = "seek"
	CmdEnded       = "ended"
	CmdSkip        = "skip"
	CmdQueueAdd    = "queue.add"
	CmdQueueRemove = "queue.remove"
	CmdQueueMove   = "queue.move"
	CmdQueuePlay   = "queue.play"
	CmdQueueUndo   = "queue.undo"
	CmdSettings    = "settings"
	// Issued only by the server, when the host goes away and comes back.
	CmdHostPass = "host.pass"
)

// Where queue.add puts a video.
const (
	AddEnd  = "end"
	AddNext = "next"
	AddNow  = "now"
)

// Command is a request to change the room.
type Command struct {
	Type string `json:"t"`
	// Item is the current video the sender was looking at.
	Item string  `json:"item,omitempty"`
	Pos  float64 `json:"pos,omitempty"`
	// CT is the client's estimate of server time when it sampled Pos.
	CT int64 `json:"ct,omitempty"`
	// Target is the queue item a queue command acts on.
	Target string `json:"target,omitempty"`
	Index  int    `json:"index,omitempty"`

	Settings *Settings `json:"settings,omitempty"`

	// Set by the server, never read from clients.
	Mode      string `json:"-"`
	Media     *Media `json:"-"`
	NewItemID string `json:"-"`
}

// UnmarshalJSON accepts a fractional CT. Browsers compute it from a clock
// offset, and half a millisecond must not lose a viewer's pause.
func (c *Command) UnmarshalJSON(data []byte) error {
	type fields Command
	wire := struct {
		*fields
		CT float64 `json:"ct"`
	}{fields: (*fields)(c)}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	c.CT = int64(math.Round(wire.CT))
	return nil
}

// Change describes what a command did, for attribution in the UI.
type Change struct {
	Cause string `json:"cause"`
	By    string `json:"by,omitempty"`
	// Queue and Settings say the event must carry those parts of the state.
	Queue    bool `json:"-"`
	Settings bool `json:"-"`
}

// Apply returns the state after a command. The input state is not modified, and
// a rejected command returns an error with no state change.
func Apply(s State, actor Actor, cmd Command, now int64) (State, Change, error) {
	s.Queue = slices.Clone(s.Queue)
	actor.Role = s.RoleOf(actor.ID, actor.Role)

	change := Change{Cause: cmd.Type, By: actor.Name}
	var err error
	switch cmd.Type {
	case CmdPlay, CmdPause, CmdSeek:
		err = applyTransport(&s, actor, cmd, now)
	case CmdEnded:
		change.Queue = true
		change.By = ""
		err = applyEnded(&s, actor, cmd, now)
	case CmdSkip:
		change.Queue = true
		err = applySkip(&s, actor, cmd, now)
	case CmdQueueAdd:
		change.Queue = true
		err = applyAdd(&s, actor, cmd, now)
		if cmd.Mode == AddNow && s.Jump != nil {
			change.Cause = CmdQueuePlay // To everyone watching, this is a jump.
		}
	case CmdQueueRemove:
		change.Queue = true
		err = applyRemove(&s, actor, cmd, now)
	case CmdQueueMove:
		change.Queue = true
		err = applyMove(&s, actor, cmd)
	case CmdQueuePlay:
		change.Queue = true
		err = applyQueuePlay(&s, actor, cmd, now)
	case CmdQueueUndo:
		change.Queue = true
		err = applyQueueUndo(&s, actor, cmd, now)
	case CmdSettings:
		change.Settings = true
		err = applySettings(&s, actor, cmd)
	case CmdHostPass:
		err = applyHostPass(&s, actor, cmd)
	default:
		err = ErrInvalid
	}
	if err != nil {
		return State{}, Change{}, err
	}

	s.Version++
	return s, change, nil
}

func allowed(mode string, actor Actor) bool {
	return actor.System || mode == ModeEveryone || actor.Role == RoleHost
}

func applyTransport(s *State, actor Actor, cmd Command, now int64) error {
	if !allowed(s.Settings.ControlMode, actor) {
		return ErrForbidden
	}
	if s.Playback.ItemID == "" || cmd.Item != s.Playback.ItemID {
		return ErrStale
	}

	at := min(max(cmd.CT, now-maxClientSkewMS), now)
	switch cmd.Type {
	case CmdPlay:
		s.Playback.Status = StatusPlaying
		s.Playback.PausedBy, s.Playback.PausedByID = "", ""
	case CmdPause:
		s.Playback.Status = StatusPaused
		s.Playback.PausedBy, s.Playback.PausedByID = actor.Name, actor.ID
	}

	if cmd.Pos < 0 {
		return ErrInvalid
	}
	s.Playback.Pos = cmd.Pos
	s.Playback.At = at
	return nil
}

// applyEnded trusts a viewer's report only near the known end, so one client's
// glitch cannot skip the video for everyone. With no known end the report is
// really a skip, so it needs the same permission. Duplicates fail the item check.
func applyEnded(s *State, actor Actor, cmd Command, now int64) error {
	if s.Playback.ItemID == "" || cmd.Item != s.Playback.ItemID {
		return ErrStale
	}
	duration := s.Queue[0].DurationMS
	if duration <= 0 && !allowed(s.Settings.ControlMode, actor) {
		return ErrForbidden
	}
	if duration > 0 && s.Playback.Position(now)*1000 < float64(duration-endToleranceMS) {
		return ErrStale
	}
	advance(s, now)
	return nil
}

func applySkip(s *State, actor Actor, cmd Command, now int64) error {
	if !allowed(s.Settings.ControlMode, actor) {
		return ErrForbidden
	}
	if s.Playback.ItemID == "" || cmd.Item != s.Playback.ItemID {
		return ErrStale
	}
	advance(s, now)
	return nil
}

func applyAdd(s *State, actor Actor, cmd Command, now int64) error {
	if !allowed(s.Settings.QueueMode, actor) {
		return ErrForbidden
	}
	if cmd.Media == nil || cmd.NewItemID == "" {
		return ErrInvalid
	}
	if len(s.Queue) >= maxQueue {
		return ErrQueueFull
	}

	item := Item{ID: cmd.NewItemID, Media: *cmd.Media, AddedBy: actor.ID, AddedByName: actor.Name}
	switch {
	case len(s.Queue) == 0:
		s.Queue = append(s.Queue, item)
		start(s, now)
	case cmd.Mode == AddNow:
		// This changes what everyone is watching, not just what comes later.
		if !allowed(s.Settings.ControlMode, actor) {
			return ErrForbidden
		}
		// It replaces what was playing, as queue.play does, and Undo brings that back.
		back := s.Playback
		back.Pos = s.PositionAt(now)
		jump := &Jump{To: item.ID, Index: 1, Replaced: s.Queue[0], Playback: back, At: now}
		s.Queue[0] = item
		start(s, now)
		s.Jump = jump
	case cmd.Mode == AddNext:
		s.Queue = slices.Insert(s.Queue, 1, item)
	case cmd.Mode == AddEnd || cmd.Mode == "":
		s.Queue = append(s.Queue, item)
	default:
		return ErrInvalid
	}
	return nil
}

func applyRemove(s *State, actor Actor, cmd Command, now int64) error {
	if !allowed(s.Settings.QueueMode, actor) {
		return ErrForbidden
	}
	index := indexOf(s.Queue, cmd.Target)
	if index < 0 {
		return ErrStale
	}
	if index == 0 {
		// Removing the current video is a skip by another name.
		if !allowed(s.Settings.ControlMode, actor) {
			return ErrForbidden
		}
		advance(s, now)
		return nil
	}
	s.Queue = slices.Delete(s.Queue, index, index+1)
	return nil
}

// applyMove reorders the upcoming videos. The current video stays first.
func applyMove(s *State, actor Actor, cmd Command) error {
	if !allowed(s.Settings.QueueMode, actor) {
		return ErrForbidden
	}
	from := indexOf(s.Queue, cmd.Target)
	if from <= 0 {
		return ErrStale
	}
	if cmd.Index < 1 || cmd.Index >= len(s.Queue) {
		return ErrInvalid
	}
	item := s.Queue[from]
	s.Queue = slices.Delete(s.Queue, from, from+1)
	s.Queue = slices.Insert(s.Queue, cmd.Index, item)
	return nil
}

func applyQueuePlay(s *State, actor Actor, cmd Command, now int64) error {
	if !allowed(s.Settings.ControlMode, actor) {
		return ErrForbidden
	}
	index := indexOf(s.Queue, cmd.Target)
	if index < 0 {
		return ErrStale
	}
	item := s.Queue[index]
	var jump *Jump
	if index > 0 {
		back := s.Playback
		back.Pos = s.PositionAt(now)
		jump = &Jump{To: item.ID, Index: index, Replaced: s.Queue[0], Playback: back, At: now}
	}
	s.Queue = slices.Delete(s.Queue, index, index+1)
	if index > 0 && len(s.Queue) > 0 {
		s.Queue = s.Queue[1:] // The video that was playing is finished with.
	}
	s.Queue = slices.Insert(s.Queue, 0, item)
	start(s, now)
	s.Jump = jump
	return nil
}

// applyQueueUndo puts back the video a jump replaced, where it had got to, and
// returns the video jumped to its place in the queue. Starting any other video
// clears the jump, so an Undo can't land on something newer.
func applyQueueUndo(s *State, actor Actor, cmd Command, now int64) error {
	if !allowed(s.Settings.ControlMode, actor) {
		return ErrForbidden
	}
	jump := s.Jump
	if jump == nil || jump.To != cmd.Target || now-jump.At > undoWindowMS {
		return ErrStale
	}
	if len(s.Queue) >= maxQueue {
		return ErrQueueFull
	}
	jumped := s.Queue[0]
	rest := s.Queue[1:]
	rest = slices.Insert(rest, min(jump.Index-1, len(rest)), jumped)
	s.Queue = slices.Insert(rest, 0, jump.Replaced)
	s.Playback = jump.Playback
	s.Playback.At = now
	if s.Playback.Status == StatusPlaying {
		s.Playback.At += StartLeadMS
	}
	s.Jump = nil
	return nil
}

func applySettings(s *State, actor Actor, cmd Command) error {
	if actor.Role != RoleHost {
		return ErrForbidden
	}
	if cmd.Settings == nil || !validMode(cmd.Settings.ControlMode) || !validMode(cmd.Settings.QueueMode) {
		return ErrInvalid
	}
	s.Settings = *cmd.Settings
	return nil
}

// applyRelease opens a locked room whose host has gone, keeping the lock to
// restore. A second server arriving at the same decision finds nothing to do.
// applyHostPass names who stands in for an absent host. No target hands the room
// back. Passing to whoever already holds it is stale, so only one server announces.
func applyHostPass(s *State, actor Actor, cmd Command) error {
	if !actor.System {
		return ErrForbidden
	}
	if s.ActingHost == cmd.Target {
		return ErrStale
	}
	s.ActingHost = cmd.Target
	return nil
}

func validMode(mode string) bool { return mode == ModeEveryone || mode == ModeHosts }

func indexOf(queue []Item, id string) int {
	return slices.IndexFunc(queue, func(item Item) bool { return item.ID == id })
}

// advance drops the current video and starts the next one, if any.
func advance(s *State, now int64) {
	if len(s.Queue) > 0 {
		s.Queue = s.Queue[1:]
	}
	start(s, now)
}

// start plays Queue[0] from the beginning, or idles when the queue is empty.
func start(s *State, now int64) {
	s.Jump = nil
	rate := s.Playback.Rate
	if len(s.Queue) == 0 {
		s.Playback = Playback{Status: StatusIdle, At: now, Rate: rate}
		return
	}
	s.Playback = Playback{
		ItemID: s.Queue[0].ID,
		Status: StatusPlaying,
		At:     now + StartLeadMS,
		Rate:   rate,
	}
}
