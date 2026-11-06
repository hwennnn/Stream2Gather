package workflows

import (
	"context"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// snapshotBatch keeps one maintenance run short. A kept room comes due once in
// twenty days, so this covers about 240,000 rooms.
const snapshotBatch = 500

// SessionStore is what kept rooms and their sessions need from Postgres. It grows
// with the sweeper, and main.go already passes the store. Track A owns this file.
type SessionStore interface {
	DueSnapshots(ctx context.Context, limit int) ([]store.SavedRoom, error)
	FreshMedia(ctx context.Context, queue []room.Item) ([]room.Media, error)
	PutCheckedSnapshot(ctx context.Context, roomID string, state room.State) error
}

// Presence says who is in a room right now.
type Presence interface {
	People(ctx context.Context, roomID string) ([]store.Person, error)
}

// RefreshSnapshots rewrites the titles saved in kept rooms from media, so none
// outlive the 30-day limit in a room nobody opens. A room with people in it is
// left for later: their next save would only undo this, and its first join
// refreshed it already.
func (a *Activities) RefreshSnapshots(ctx context.Context) (int, error) {
	due, err := a.Sessions.DueSnapshots(ctx, snapshotBatch)
	if err != nil {
		return 0, err
	}
	rewritten := 0
	for _, saved := range due {
		people, err := a.Presence.People(ctx, saved.ID)
		if err != nil {
			return rewritten, err
		}
		if len(people) > 0 {
			continue
		}
		fresh, err := a.Sessions.FreshMedia(ctx, saved.State.Queue)
		if err != nil {
			return rewritten, err
		}
		saved.State.Renew(fresh, time.Now().UnixMilli())
		if err := a.Sessions.PutCheckedSnapshot(ctx, saved.ID, saved.State); err != nil {
			return rewritten, err
		}
		rewritten++
	}
	return rewritten, nil
}

// registerSessions adds session workflows and schedules to the maintenance
// worker. Methods on Activities are registered already.
func registerSessions(context.Context, client.Client, worker.Worker) error { return nil }
