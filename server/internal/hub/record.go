package hub

import (
	"context"
	"time"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// The kinds of Moment.
const (
	MomentReaction = "reaction"
	MomentChat     = "chat"
)

// Moment is a reaction or chat line, before anyone has worked out its position.
type Moment struct {
	Kind      string
	UserID    string
	Author    string
	Emoji     string
	MessageID int64
	At        time.Time
}

// Recorder hears what happens in rooms. Every method but Run is called from a
// room's hot path, so none may block. Track A owns this file.
type Recorder interface {
	// Run does the recorder's work until ctx ends. Hub.Run starts it.
	Run(ctx context.Context)
	// Applied sees every state change, system commands included.
	Applied(roomID string, s room.State)
	// Joined fires for each connection, so a second tab fires it again.
	Joined(roomID string, p store.Person)
	// Left fires once the person has no connection left, on any server.
	Left(roomID, userID string)
	Moment(roomID string, m Moment)
}

// newRecorder is where the hub gets its recorder.
func newRecorder(*Hub) Recorder { return noRecorder{} }

type noRecorder struct{}

func (noRecorder) Run(context.Context)         {}
func (noRecorder) Applied(string, room.State)  {}
func (noRecorder) Joined(string, store.Person) {}
func (noRecorder) Left(string, string)         {}
func (noRecorder) Moment(string, Moment)       {}
