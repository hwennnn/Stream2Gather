package room

import "slices"

// Command types.
const (
	CmdPlay        = "play"
	CmdPause       = "pause"
	CmdSeek        = "seek"
	CmdRate        = "rate"
	CmdEnded       = "ended"
	CmdSkip        = "skip"
	CmdQueueAdd    = "queue.add"
	CmdQueueRemove = "queue.remove"
	CmdQueueMove   = "queue.move"
	CmdQueuePlay   = "queue.play"
	CmdQueueClear  = "queue.clear"
	CmdSettings    = "settings"
)

// Command is a request to change the room.
type Command struct {
	Type string `json:"t"`
	// Item is the current video the sender was looking at.
	Item string  `json:"item,omitempty"`
	Pos  float64 `json:"pos,omitempty"`
	// CT is the client's estimate of server time when it sampled Pos.
	CT   int64   `json:"ct,omitempty"`
	Rate float64 `json:"rate,omitempty"`
	// Target is the queue item a queue command acts on.
	Target string `json:"target,omitempty"`
	Index  int    `json:"index,omitempty"`

	PlayNow  bool      `json:"playNow,omitempty"`
	Settings *Settings `json:"settings,omitempty"`

	// Set by the server, never read from clients.
	Media     *Media `json:"-"`
	NewItemID string `json:"-"`
}

// Change describes what a command did, for attribution in the UI.
type Change struct {
	Cause string `json:"cause"`
	By    string `json:"by,omitempty"`
	// Playback and Queue say which parts of the state changed.
	Playback bool `json:"-"`
	Queue    bool `json:"-"`
	Settings bool `json:"-"`
}

// Apply returns the state after a command. The input state is not modified, and
// a rejected command returns an error with no state change.
func Apply(s State, actor Actor, cmd Command, now int64) (State, Change, error) {
	s.Queue = slices.Clone(s.Queue)

	change := Change{Cause: cmd.Type, By: actor.Name}
	var err error
	switch cmd.Type {
	case CmdPlay, CmdPause, CmdSeek, CmdRate:
		change.Playback = true
		err = applyTransport(&s, actor, cmd, now)
	case CmdEnded:
		change.Playback, change.Queue = true, true
		change.By = ""
		err = applyEnded(&s, cmd, now)
	case CmdSkip:
		change.Playback, change.Queue = true, true
		err = applySkip(&s, actor, cmd, now)
	case CmdQueueAdd:
		change.Queue = true
		change.Playback, err = applyAdd(&s, actor, cmd, now)
	case CmdQueueRemove:
		change.Queue = true
		change.Playback, err = applyRemove(&s, actor, cmd, now)
	case CmdQueueMove:
		change.Queue = true
		err = applyMove(&s, actor, cmd)
	case CmdQueuePlay:
		change.Playback, change.Queue = true, true
		err = applyQueuePlay(&s, actor, cmd, now)
	case CmdQueueClear:
		change.Queue = true
		err = applyClear(&s, actor)
	case CmdSettings:
		change.Settings = true
		err = applySettings(&s, actor, cmd)
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
	case CmdPause:
		s.Playback.Status = StatusPaused
	case CmdRate:
		if cmd.Rate < 0.25 || cmd.Rate > 2 {
			return ErrInvalid
		}
		s.Playback.Pos = s.Playback.Position(at)
		s.Playback.At = at
		s.Playback.Rate = cmd.Rate
		return nil
	}

	if cmd.Pos < 0 {
		return ErrInvalid
	}
	s.Playback.Pos = cmd.Pos
	s.Playback.At = at
	return nil
}

// applyEnded trusts a viewer's report only near the known end, so one client's
// glitch cannot skip the video for everyone. Duplicates fail the item check.
func applyEnded(s *State, cmd Command, now int64) error {
	if s.Playback.ItemID == "" || cmd.Item != s.Playback.ItemID {
		return ErrStale
	}
	if duration := s.Queue[0].DurationMS; duration > 0 {
		if s.Playback.Position(now)*1000 < float64(duration-endToleranceMS) {
			return ErrStale
		}
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

func applyAdd(s *State, actor Actor, cmd Command, now int64) (bool, error) {
	if !allowed(s.Settings.QueueMode, actor) {
		return false, ErrForbidden
	}
	if cmd.Media == nil || cmd.NewItemID == "" {
		return false, ErrInvalid
	}
	if len(s.Queue) >= maxQueue {
		return false, ErrQueueFull
	}

	item := Item{ID: cmd.NewItemID, Media: *cmd.Media, AddedBy: actor.ID, AddedByName: actor.Name}
	if cmd.PlayNow || len(s.Queue) == 0 {
		s.Queue = slices.Insert(s.Queue, 0, item)
		start(s, now)
		return true, nil
	}
	s.Queue = append(s.Queue, item)
	return false, nil
}

func applyRemove(s *State, actor Actor, cmd Command, now int64) (bool, error) {
	if !allowed(s.Settings.QueueMode, actor) {
		return false, ErrForbidden
	}
	index := indexOf(s.Queue, cmd.Target)
	if index < 0 {
		return false, ErrStale
	}
	if index == 0 {
		advance(s, now)
		return true, nil
	}
	s.Queue = slices.Delete(s.Queue, index, index+1)
	return false, nil
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
	s.Queue = slices.Delete(s.Queue, index, index+1)
	if index > 0 && len(s.Queue) > 0 {
		s.Queue = s.Queue[1:] // The video that was playing is finished with.
	}
	s.Queue = slices.Insert(s.Queue, 0, item)
	start(s, now)
	return nil
}

func applyClear(s *State, actor Actor) error {
	if !allowed(s.Settings.QueueMode, actor) {
		return ErrForbidden
	}
	if len(s.Queue) > 1 {
		s.Queue = s.Queue[:1]
	}
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
