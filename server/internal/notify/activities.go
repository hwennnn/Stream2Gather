// Package notify decides who hears about a session, and when. Temporal owns the
// timing and retries, and only s2g notifier runs this. serve must not import it.
package notify

import (
	"context"
	"errors"

	"go.temporal.io/sdk/temporal"

	"stream2gather/internal/notify/webpush"
	"stream2gather/internal/store"
)

const (
	// Queue is the Temporal task queue the notifier serves.
	Queue = "notify"

	KindStarted = "session.started"
	KindRecap   = "recap.ready"
)

// Store is what deciding and recording needs from Postgres.
type Store interface {
	SessionNotice(ctx context.Context, sessionID string) (store.SessionNotice, error)
	SessionAudience(ctx context.Context, sessionID string, notice store.SessionNotice) ([]string, error)
	RecapAudience(ctx context.Context, sessionID string, notice store.SessionNotice) ([]string, error)
	ClaimNotification(ctx context.Context, userID, crewID, kind, ref string) (bool, error)
	ReleaseNotification(ctx context.Context, userID, kind, ref string) error
}

// Plan is one notification and who should get it.
type Plan struct {
	CrewID   string
	Message  webpush.Message
	Audience []string
}

// Delivery is one person's copy.
type Delivery struct {
	UserID, CrewID, Kind, Ref string
	Message                   webpush.Message
}

// Activities are the steps that touch Postgres and push services.
type Activities struct {
	Store   Store
	Channel Channel
}

// PlanSession reads who to ping now the timer is up. A session that ended, or a
// crew that closed, has nobody. Nor does a false start: the sweeper gives a session
// five minutes, so inside the timer the only sign of one is that everyone has gone.
func (a *Activities) PlanSession(ctx context.Context, sessionID string) (Plan, error) {
	notice, err := a.Store.SessionNotice(ctx, sessionID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && (!notice.Open || !notice.Attended)) {
		return Plan{}, nil
	}
	if err != nil {
		return Plan{}, err
	}
	audience, err := a.Store.SessionAudience(ctx, sessionID, notice)
	who := notice.Starter
	if who == "" {
		who = "Someone"
	}
	return Plan{notice.CrewID, webpush.Message{
		Title:    who + " started watching in " + notice.CrewName,
		Body:     "Join in",
		Navigate: "/r/" + notice.Slug,
	}, audience}, err
}

// PlanRecap reads who came. The crew home opens on the recap.
func (a *Activities) PlanRecap(ctx context.Context, sessionID string) (Plan, error) {
	notice, err := a.Store.SessionNotice(ctx, sessionID)
	if errors.Is(err, store.ErrNotFound) {
		return Plan{}, nil
	}
	if err != nil {
		return Plan{}, err
	}
	audience, err := a.Store.RecapAudience(ctx, sessionID, notice)
	return Plan{notice.CrewID, webpush.Message{
		Title:    "Your recap from " + notice.CrewName + " is ready",
		Body:     "See how it went",
		Navigate: "/r/" + notice.Slug,
	}, audience}, err
}

// Deliver sends one person's copy at most once. The claim comes first, so a crash
// mid-send loses a ping rather than doubling it, and it is given back when nothing
// got through, so a retry can run and the 30 minute cap isn't spent on silence.
func (a *Activities) Deliver(ctx context.Context, d Delivery) error {
	claimed, err := a.Store.ClaimNotification(ctx, d.UserID, d.CrewID, d.Kind, d.Ref)
	if err != nil || !claimed {
		return err
	}
	reached, err := a.Channel.Reach(ctx, d.UserID, d.CrewID, d.Message)
	if reached {
		return nil
	}
	if released := a.Store.ReleaseNotification(context.WithoutCancel(ctx), d.UserID, d.Kind, d.Ref); released != nil {
		return temporal.NewNonRetryableApplicationError("claim not released", "claim", released)
	}
	var retry *webpush.RetryError
	if errors.As(err, &retry) {
		return temporal.NewApplicationErrorWithOptions(err.Error(), "push_retry", temporal.ApplicationErrorOptions{
			NextRetryDelay: retry.After,
		})
	}
	return err
}
