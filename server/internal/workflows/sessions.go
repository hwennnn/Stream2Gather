package workflows

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// snapshotBatch keeps one maintenance run short. A kept room comes due once in
// twenty days, so this covers about 240,000 rooms.
const snapshotBatch = 500

const (
	sweepScheduleID = "sessions-sweep"
	emptyFor        = 5 * time.Minute
	quietFor        = 30 * time.Minute
	recapBatch      = 200
)

// SessionStore is what kept rooms and their sessions need from Postgres. It grows
// with the sweeper, and main.go already passes the store. Track A owns this file.
type SessionStore interface {
	DueSnapshots(ctx context.Context, limit int) ([]store.SavedRoom, error)
	FreshMedia(ctx context.Context, queue []room.Item) ([]room.Media, error)
	PutCheckedSnapshot(ctx context.Context, roomID string, state room.State) error
	SecondSessions(ctx context.Context) (cohort, returned int64, err error)
	OpenSessions(ctx context.Context) ([]store.OpenSession, error)
	TouchSession(ctx context.Context, sessionID string, at time.Time) error
	EndSession(ctx context.Context, sessionID string, at time.Time) (bool, error)
	UnbuiltSessions(ctx context.Context, limit int) ([]string, error)
	BuildRecap(ctx context.Context, sessionID string) error
}

// Presence says who is in a room right now, and what it's doing.
type Presence interface {
	People(ctx context.Context, roomID string) ([]store.Person, error)
	Load(ctx context.Context, roomID string) (room.State, bool, error)
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

// sessionEnd says when a session ended, if it has. A session is over five minutes
// after the last person left, or thirty after the last playback or chat. A video
// that's still playing to someone counts as playback, which only the sweeper can
// see, because nothing happens in a room while a film plays through.
func sessionEnd(s store.OpenSession, present, playing bool, now time.Time) (time.Time, bool) {
	if !present {
		last := s.LastActivity
		if s.LastLeft.After(last) {
			last = s.LastLeft
		}
		return last, now.Sub(last) >= emptyFor
	}
	if playing {
		return time.Time{}, false
	}
	return s.LastActivity, now.Sub(s.LastActivity) >= quietFor
}

// SweepSessions ends what has ended, wherever the servers that ran it have gone.
// It is the only thing that ends a session. One broken room can't stop the rest.
func (a *Activities) SweepSessions(ctx context.Context) (int, error) {
	open, err := a.Sessions.OpenSessions(ctx)
	if err != nil {
		return 0, err
	}
	ended := 0
	var failures []error
	for _, session := range open {
		done, err := a.sweep(ctx, session, time.Now())
		if err != nil {
			failures = append(failures, fmt.Errorf("session %s: %w", session.ID, err))
		}
		if done {
			ended++
		}
	}
	// Reading back what has no recap also picks up a build that failed last time.
	unbuilt, err := a.Sessions.UnbuiltSessions(ctx, recapBatch)
	if err != nil {
		failures = append(failures, err)
	}
	for _, sessionID := range unbuilt {
		if err := a.Sessions.BuildRecap(ctx, sessionID); err != nil {
			failures = append(failures, fmt.Errorf("recap %s: %w", sessionID, err))
		}
	}
	return ended, errors.Join(failures...)
}

func (a *Activities) sweep(ctx context.Context, session store.OpenSession, now time.Time) (bool, error) {
	people, err := a.Presence.People(ctx, session.RoomID)
	if err != nil {
		return false, err
	}
	state, found, err := a.Presence.Load(ctx, session.RoomID)
	if err != nil {
		return false, err
	}
	present := len(people) > 0
	playing := found && state.Playback.Status == room.StatusPlaying
	at, over := sessionEnd(session, present, playing, now)
	if over {
		return a.Sessions.EndSession(ctx, session.ID, at)
	}
	if present && playing {
		return false, a.Sessions.TouchSession(ctx, session.ID, now)
	}
	return false, nil
}

// MeasureCrews reports crew_second_session_14d, the phase's headline number: of
// the crews whose first fortnight is over, the share that came back within it.
func (a *Activities) MeasureCrews(ctx context.Context) error {
	cohort, returned, err := a.Sessions.SecondSessions(ctx)
	if err != nil || cohort == 0 {
		return err
	}
	a.metric("crew_second_session_14d", float64(returned)/float64(cohort))
	return nil
}

// Sweep is the workflow behind the sweep schedule.
func Sweep(ctx workflow.Context) (int, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 50 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 1},
	})
	var activities *Activities
	var ended int
	err := workflow.ExecuteActivity(ctx, activities.SweepSessions).Get(ctx, &ended)
	return ended, err
}

// registerSessions adds session workflows and schedules to the maintenance
// worker. Methods on Activities are registered already.
func registerSessions(ctx context.Context, c client.Client, w worker.Worker) error {
	w.RegisterWorkflow(Sweep)
	_, err := c.ScheduleClient().Create(ctx, client.ScheduleOptions{
		ID:   sweepScheduleID,
		Spec: client.ScheduleSpec{Intervals: []client.ScheduleIntervalSpec{{Every: time.Minute}}},
		// A run that overruns skips the next, and the one after sees everything anyway.
		Overlap: enums.SCHEDULE_OVERLAP_POLICY_SKIP,
		Action: &client.ScheduleWorkflowAction{
			ID:        "sweep-sessions",
			Workflow:  Sweep,
			TaskQueue: taskQueue,
		},
	})
	var exists *serviceerror.WorkflowExecutionAlreadyStarted
	if err != nil && !errors.As(err, &exists) && !errors.Is(err, temporal.ErrScheduleAlreadyRunning) {
		return fmt.Errorf("create sweep schedule: %w", err)
	}
	return nil
}
