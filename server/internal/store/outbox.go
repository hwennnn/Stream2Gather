package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	// A ping about a session this old would only send someone to an empty room.
	startedShelfLife = 5 * time.Minute
	recapShelfLife   = 24 * time.Hour
	outboxBatch      = 100
)

// OutboxRow is one thing waiting to be told.
type OutboxRow struct {
	ID   int64
	Kind string
	Ref  string
}

// WaitingOutbox reads the oldest rows nobody has handled.
func (p *Postgres) WaitingOutbox(ctx context.Context) ([]OutboxRow, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, kind, ref FROM outbox WHERE done_at IS NULL ORDER BY id LIMIT $1`, outboxBatch)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (OutboxRow, error) {
		var waiting OutboxRow
		return waiting, row.Scan(&waiting.ID, &waiting.Kind, &waiting.Ref)
	})
}

// FinishOutbox marks one row handled.
func (p *Postgres) FinishOutbox(ctx context.Context, id int64) error {
	_, err := p.pool.Exec(ctx, `UPDATE outbox SET done_at = now() WHERE id = $1`, id)
	return err
}

// ExpireOutbox closes rows too old to send, which is what stops a long outage
// ending in a burst of stale pings. It returns how many went unsent.
func (p *Postgres) ExpireOutbox(ctx context.Context) (int64, error) {
	tag, err := p.pool.Exec(ctx, `
		UPDATE outbox SET done_at = now()
		WHERE done_at IS NULL AND created_at < now() - CASE kind
			WHEN 'session.started' THEN $1::interval ELSE $2::interval END`, startedShelfLife, recapShelfLife)
	return tag.RowsAffected(), err
}

// ListenOutbox calls wake whenever the outbox is told about, and at least once per
// poll. It holds one connection and returns when that connection fails.
func (p *Postgres) ListenOutbox(ctx context.Context, poll time.Duration, wake func(context.Context)) error {
	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	// A connection left listening must not go back into the pool.
	defer func() {
		_ = conn.Conn().Close(context.Background())
		conn.Release()
	}()
	if _, err := conn.Exec(ctx, `LISTEN outbox`); err != nil {
		return err
	}
	for {
		wake(ctx)
		wait, cancel := context.WithTimeout(ctx, poll)
		_, err := conn.Conn().WaitForNotification(wait)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if err != nil && !errors.Is(err, context.DeadlineExceeded) {
			return err
		}
	}
}
