// Package room holds the rules of a watch-together room as pure functions, so
// every ordering and permission decision can be tested without a server.
package room

import "errors"

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
	maxQueue       = 200
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
}

// Settings are the room's permissions.
type Settings struct {
	ControlMode string `json:"controlMode"`
	QueueMode   string `json:"queueMode"`
}

// State is the whole live room. Queue[0] is the current video when one is set.
type State struct {
	Version  int64    `json:"version"`
	Playback Playback `json:"playback"`
	Queue    []Item   `json:"queue"`
	Settings Settings `json:"settings"`
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

// Actor is who issued a command.
type Actor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
	// System marks commands the server issues itself.
	System bool `json:"-"`
}
