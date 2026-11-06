package notify

import (
	"hash/fnv"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// The wait stops a false start from pinging anyone. Spreading it keeps crews
	// that start together from sending in one burst.
	minSettle  = 30 * time.Second
	settleSpan = 16

	// A push service drops a message after its 300 second TTL, so stop trying then.
	deliverWindow = 5 * time.Minute
)

// settle is 30 to 45 seconds, from the session id so that a replay gets the same.
func settle(sessionID string) time.Duration {
	sum := fnv.New32a()
	_, _ = sum.Write([]byte(sessionID))
	return minSettle + time.Duration(sum.Sum32()%settleSpan)*time.Second
}

// NotifySession pings absent members once a session has lasted past the timer.
func NotifySession(ctx workflow.Context, sessionID string) error {
	if err := workflow.Sleep(ctx, settle(sessionID)); err != nil {
		return err
	}
	var a *Activities
	return tell(ctx, a.PlanSession, KindStarted, sessionID)
}

// NotifyRecap tells the people who came that their recap is ready.
func NotifyRecap(ctx workflow.Context, sessionID string) error {
	var a *Activities
	return tell(ctx, a.PlanRecap, KindRecap, sessionID)
}

func tell(ctx workflow.Context, plan any, kind, ref string) error {
	planning := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout:    30 * time.Second,
		ScheduleToCloseTimeout: 2 * time.Minute,
	})
	var todo Plan
	if err := workflow.ExecuteActivity(planning, plan, ref).Get(ctx, &todo); err != nil {
		return err
	}
	sending := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout:    2 * time.Minute,
		ScheduleToCloseTimeout: deliverWindow,
		RetryPolicy:            &temporal.RetryPolicy{InitialInterval: 5 * time.Second, BackoffCoefficient: 2, MaximumInterval: time.Minute},
	})
	var a *Activities
	pending := make([]workflow.Future, 0, len(todo.Audience))
	for _, userID := range todo.Audience {
		pending = append(pending, workflow.ExecuteActivity(sending, a.Deliver, Delivery{userID, todo.CrewID, kind, ref, todo.Message}))
	}
	// One person's failure doesn't touch anyone else's copy.
	var failed error
	for _, future := range pending {
		if err := future.Get(ctx, nil); err != nil {
			failed = err
		}
	}
	return failed
}
