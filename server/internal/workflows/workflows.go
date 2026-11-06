// Package workflows runs Stream2Gather's durable background jobs.
package workflows

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

const (
	taskQueue  = "maintenance"
	scheduleID = "maintenance-hourly"
	// One run stays within a small slice of the daily API quota.
	refreshBatch = 500
)

// RoomCloser closes rooms past their expiry.
type RoomCloser interface {
	CloseExpiredRooms(ctx context.Context) (int64, error)
}

// MediaRefresher renews stored metadata.
type MediaRefresher interface {
	RefreshStale(ctx context.Context, limit int) (refreshed, deleted int, err error)
}

// Activities are the steps that touch the outside world.
type Activities struct {
	Rooms RoomCloser
	Media MediaRefresher
}

// Summary reports what one maintenance run did.
type Summary struct {
	RoomsClosed  int64
	Refreshed    int
	MediaDeleted int
}

// CloseRooms ends expired rooms.
func (a *Activities) CloseRooms(ctx context.Context) (int64, error) {
	return a.Rooms.CloseExpiredRooms(ctx)
}

// RefreshMedia renews metadata before YouTube's 30-day limit.
func (a *Activities) RefreshMedia(ctx context.Context) (Summary, error) {
	refreshed, deleted, err := a.Media.RefreshStale(ctx, refreshBatch)
	return Summary{Refreshed: refreshed, MediaDeleted: deleted}, err
}

// Maintenance closes expired rooms and refreshes media. The steps are separate
// so an outage at YouTube cannot stop rooms from expiring.
func Maintenance(ctx workflow.Context) (Summary, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 5, InitialInterval: 10 * time.Second},
	})

	var activities *Activities
	var summary Summary
	closeErr := workflow.ExecuteActivity(ctx, activities.CloseRooms).Get(ctx, &summary.RoomsClosed)

	var refresh Summary
	refreshErr := workflow.ExecuteActivity(ctx, activities.RefreshMedia).Get(ctx, &refresh)
	summary.Refreshed, summary.MediaDeleted = refresh.Refreshed, refresh.MediaDeleted

	return summary, errors.Join(closeErr, refreshErr)
}

// Run starts the worker and ensures the hourly schedule exists.
func Run(ctx context.Context, address, namespace string, log *slog.Logger, activities *Activities) error {
	temporalClient, err := client.DialContext(ctx, client.Options{HostPort: address, Namespace: namespace})
	if err != nil {
		return fmt.Errorf("connect to temporal: %w", err)
	}
	defer temporalClient.Close()

	_, err = temporalClient.ScheduleClient().Create(ctx, client.ScheduleOptions{
		ID:   scheduleID,
		Spec: client.ScheduleSpec{Intervals: []client.ScheduleIntervalSpec{{Every: time.Hour}}},
		Action: &client.ScheduleWorkflowAction{
			ID:        "maintenance",
			Workflow:  Maintenance,
			TaskQueue: taskQueue,
		},
	})
	var exists *serviceerror.WorkflowExecutionAlreadyStarted
	if err != nil && !errors.As(err, &exists) && !errors.Is(err, temporal.ErrScheduleAlreadyRunning) {
		return fmt.Errorf("create schedule: %w", err)
	}

	w := worker.New(temporalClient, taskQueue, worker.Options{})
	w.RegisterWorkflow(Maintenance)
	w.RegisterActivity(activities)

	log.Info("worker started", "temporal", address, "namespace", namespace)
	stop := make(chan any)
	go func() {
		<-ctx.Done()
		close(stop)
	}()
	return w.Run(stop)
}
