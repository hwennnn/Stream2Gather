// Package room holds the rules of a watch-together room as pure functions, so
// every ordering and permission decision can be tested without a server.
package room

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Playback statuses.
const (
	StatusIdle    = "idle"
	StatusPlaying = "playing"
	StatusPaused  = "paused"
)

// Who may change playback or the queue.
const (
	ModeEveryone = "everyone"
	ModeHosts    = "hosts"
)

// Roles a member can hold.
const (
	RoleHost   = "host"
	RoleMember = "member"
)

const (
	// StartLeadMS gives every viewer time to load before a new video starts.
	StartLeadMS = 1500
	// maxClientSkewMS bounds how far back a client can date a command.
	maxClientSkewMS = 2000
	// endToleranceMS is how early an "ended" report is believed.
	endToleranceMS = 5000
	// undoWindowMS is how long a jump can be undone. Clients offer it for less,
	// so an Undo pressed at the last moment still lands.
	undoWindowMS = 8000
	maxQueue     = 200
	// MaxNameRunes is the longest display name.
	MaxNameRunes = 32
)

// Rejected commands. A stale command refers to a video that is no longer
// current, such as a late seek arriving after a skip.
var (
	ErrStale     = errors.New("stale command")
	ErrForbidden = errors.New("not allowed")
	ErrInvalid   = errors.New("invalid command")
	ErrQueueFull = errors.New("queue is full")
)

// Media describes a playable video. The server resolves it; clients never
// supply these fields.
type Media struct {
	Source       string `json:"source"`
	SourceID     string `json:"sourceId"`
	URL          string `json:"url"`
	Title        string `json:"title"`
	Author       string `json:"author"`
	ThumbnailURL string `json:"thumbnailUrl"`
	DurationMS   int64  `json:"durationMs"`
	IsLive       bool   `json:"isLive"`
}

// Item is one entry in a room's queue.
type Item struct {
	ID string `json:"id"`
	Media
	AddedBy     string `json:"addedBy"`
	AddedByName string `json:"addedByName"`
}

// Playback says the video was at Pos seconds at server time At, moving at Rate.
// At can be in the future, which is how viewers start together.
type Playback struct {
	ItemID string  `json:"item"`
	Status string  `json:"status"`
	Pos    float64 `json:"pos"`
	At     int64   `json:"at"`
	Rate   float64 `json:"rate"`
	// PausedBy and PausedByID say who paused, so a viewer arriving later can be
	// told. Both are empty when nobody did: see Rested.
	PausedBy   string `json:"pausedBy,omitempty"`
	PausedByID string `json:"pausedById,omitempty"`
}

// Settings are the room's permissions.
type Settings struct {
	ControlMode string `json:"controlMode"`
	QueueMode   string `json:"queueMode"`
}

// Locked reports whether anything is limited to the host.
func (s Settings) Locked() bool { return s.ControlMode == ModeHosts || s.QueueMode == ModeHosts }

// Jump remembers what queue.play replaced, so the room can go back to it.
type Jump struct {
	// To is the video jumped to, and Index where it sat in the queue.
	To    string `json:"to"`
	Index int    `json:"index"`
	// Replaced was playing, and Playback is where it had got to.
	Replaced Item     `json:"replaced"`
	Playback Playback `json:"playback"`
	At       int64    `json:"at"`
}

// State is the whole live room. Queue[0] is the current video when one is set.
type State struct {
	Version  int64    `json:"version"`
	Playback Playback `json:"playback"`
	Queue    []Item   `json:"queue"`
	Settings Settings `json:"settings"`
	// Held keeps the host's lock while it is released for an absent host.
	Held *Settings `json:"held,omitempty"`
	// Jump is set while the latest video change can still be undone.
	Jump *Jump `json:"jump,omitempty"`
}

// New returns an empty room.
func New() State {
	return State{
		Playback: Playback{Status: StatusIdle, Rate: 1},
		Queue:    []Item{},
		Settings: Settings{ControlMode: ModeEveryone, QueueMode: ModeEveryone},
	}
}

// Position returns where the video should be at server time now.
func (p Playback) Position(now int64) float64 {
	if p.Status != StatusPlaying || now <= p.At {
		return p.Pos
	}
	return p.Pos + float64(now-p.At)/1000*p.Rate
}

// PositionAt is Position, stopped at the end of a video of known length. A room
// nobody is watching can otherwise run on well past it.
func (s State) PositionAt(now int64) float64 {
	pos := s.Playback.Position(now)
	if len(s.Queue) > 0 && s.Queue[0].DurationMS > 0 {
		return min(pos, float64(s.Queue[0].DurationMS)/1000)
	}
	return pos
}

// Rested is a room restored from a snapshot with nobody watching: paused where
// it was when saved at savedAt, not wherever the clock would have taken it since.
func (s State) Rested(savedAt, now int64) State {
	if s.Playback.Status == StatusPlaying {
		s.Playback.Pos = s.PositionAt(savedAt)
		s.Playback.At = now
		s.Playback.Status = StatusPaused
	}
	return s
}

// CleanName returns a display name fit to store, or false if it is not one.
// Control characters are refused because Postgres rejects NUL and every viewer
// would otherwise render the rest.
func CleanName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	if name == "" || utf8.RuneCountInString(name) > MaxNameRunes || !utf8.ValidString(name) {
		return "", false
	}
	if strings.ContainsFunc(name, unicode.IsControl) {
		return "", false
	}
	return name, true
}

// CleanChat returns a chat line fit to store, or false if it is not one. Line
// breaks and tabs are text. Other control characters are not, and Postgres would
// answer a NUL with an error the sender could only read as a server fault.
func CleanChat(raw string) (string, bool) {
	text := strings.TrimSpace(raw)
	unprintable := func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }
	if text == "" || strings.ContainsFunc(text, unprintable) {
		return "", false
	}
	return text, true
}

// Actor is who issued a command.
type Actor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
	// System marks commands the server issues itself.
	System bool `json:"-"`
}
