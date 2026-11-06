package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"stream2gather/internal/ids"
)

// maxDevices stops one account growing without end. Browsers rotate endpoints,
// so the oldest are the likeliest to be dead already.
const maxDevices = 10

// PushDevice is one browser that gets pings. Its keys stay out of here, since
// this goes back to the person's page.
type PushDevice struct {
	ID        string     `json:"id"`
	UserAgent string     `json:"userAgent"`
	CreatedAt time.Time  `json:"createdAt"`
	LastOK    *time.Time `json:"lastOkAt"`
}

// PushCrew is one crew's setting for this person.
type PushCrew struct {
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	Notify string `json:"notify"`
}

// SavePushSubscription stores a browser under this person and returns its id. An
// endpoint is one browser profile, so a second account signing in there takes it
// over. A saved browser counts as new, or the limit below could remove it at once.
func (p *Postgres) SavePushSubscription(ctx context.Context, userID, endpoint, p256dh, auth, userAgent string) (string, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
			auth = excluded.auth, user_agent = excluded.user_agent, created_at = now()
		RETURNING id`, ids.New(), userID, endpoint, p256dh, auth, userAgent).Scan(&id)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `
		DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN (
			SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)`, userID, maxDevices)
	if err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

// DeletePushSubscription removes one of this person's browsers.
func (p *Postgres) DeletePushSubscription(ctx context.Context, userID, id string) error {
	tag, err := p.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ForgetPushDevices removes every browser a person has, at sign-out.
func (p *Postgres) ForgetPushDevices(ctx context.Context, userID string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id = $1`, userID)
	return err
}

// PushDevices lists this person's browsers, newest first.
func (p *Postgres) PushDevices(ctx context.Context, userID string) ([]PushDevice, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, COALESCE(user_agent, ''), created_at, last_ok_at
		FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PushDevice, error) {
		var device PushDevice
		return device, row.Scan(&device.ID, &device.UserAgent, &device.CreatedAt, &device.LastOK)
	})
}

// PushCrews lists the crews this person could hear from.
func (p *Postgres) PushCrews(ctx context.Context, userID string) ([]PushCrew, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT r.slug, r.name, m.notify
		FROM crew_members m JOIN crews c ON c.id = m.crew_id JOIN rooms r ON r.id = c.room_id
		WHERE m.user_id = $1 AND r.closed_at IS NULL ORDER BY r.name`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PushCrew, error) {
		var crew PushCrew
		return crew, row.Scan(&crew.Slug, &crew.Name, &crew.Notify)
	})
}
