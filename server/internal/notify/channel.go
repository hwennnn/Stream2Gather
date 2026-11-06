package notify

import (
	"context"
	"errors"
	"log/slog"

	"stream2gather/internal/notify/webpush"
	"stream2gather/internal/store"
)

// Channel reaches a person. Web push is the only one until there is an email
// provider. reached means at least one device took the message; err means
// nothing reached them yet and trying again may help.
type Channel interface {
	Reach(ctx context.Context, userID, topic string, message webpush.Message) (reached bool, err error)
}

// Devices is what Push needs from Postgres.
type Devices interface {
	PushTargets(ctx context.Context, userID string) ([]store.PushTarget, error)
	DropPushTarget(ctx context.Context, id string) error
	MarkPushOK(ctx context.Context, id string) error
}

// Push sends to every browser a person has.
type Push struct {
	Devices Devices
	Sender  *webpush.Sender
	Log     *slog.Logger
}

// Reach tries each device once. A device that fails after another took the
// message misses this one: retrying would ping the others twice.
func (p *Push) Reach(ctx context.Context, userID, topic string, message webpush.Message) (bool, error) {
	targets, err := p.Devices.PushTargets(ctx, userID)
	if err != nil {
		return false, err
	}
	reached := false
	var again error
	for _, target := range targets {
		to := webpush.Subscription{Endpoint: target.Endpoint, P256dh: target.P256dh, Auth: target.Auth}
		err := p.Sender.Send(ctx, to, topic, message)
		var retry *webpush.RetryError
		switch {
		case err == nil:
			reached = true
			if err := p.Devices.MarkPushOK(ctx, target.ID); err != nil {
				p.Log.Warn("push sent but not recorded", "error", err)
			}
		case errors.Is(err, webpush.ErrGone):
			if err := p.Devices.DropPushTarget(ctx, target.ID); err != nil {
				p.Log.Warn("dead subscription not removed", "error", err)
			}
		case errors.As(err, &retry):
			again = err
		default:
			p.Log.Warn("push refused", "error", err)
		}
	}
	return reached, again
}
