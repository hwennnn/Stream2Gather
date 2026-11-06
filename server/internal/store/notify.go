package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// pingCap keeps a crew that starts and stops from pinging anyone twice in a row.
const pingCap = 30 * time.Minute

// SessionNotice is what a ping says, and whether it's still worth saying.
type SessionNotice struct {
	CrewID    string
	Slug      string
	CrewName  string
	StarterID string
	// Starter is empty when a guest started it or the account has gone.
	Starter string
	Open    bool
}

// PushTarget is one browser to reach.
type PushTarget struct {
	ID       string
	Endpoint string
	P256dh   string
	Auth     string
}

// SessionNotice reads a session, or returns ErrNotFound once its crew has gone.
func (p *Postgres) SessionNotice(ctx context.Context, sessionID string) (SessionNotice, error) {
	var notice SessionNotice
	err := p.pool.QueryRow(ctx, `
		SELECT s.crew_id, r.slug, r.name, COALESCE(s.started_by, ''), COALESCE(u.display_name, ''), s.ended_at IS NULL
		FROM crew_sessions s
		JOIN crews c ON c.id = s.crew_id JOIN rooms r ON r.id = c.room_id
		LEFT JOIN users u ON u.id = s.started_by
		WHERE s.id = $1`, sessionID,
	).Scan(&notice.CrewID, &notice.Slug, &notice.CrewName, &notice.StarterID, &notice.Starter, &notice.Open)
	if errors.Is(err, pgx.ErrNoRows) {
		return SessionNotice{}, ErrNotFound
	}
	return notice, err
}

// SessionAudience is who to ping about a session: members who want it, have a
// device, aren't already there and weren't pinged for this crew just now. Who is
// here comes from session_people, since the notifier has no Redis.
func (p *Postgres) SessionAudience(ctx context.Context, sessionID string, notice SessionNotice) ([]string, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT m.user_id FROM crew_members m
		WHERE m.crew_id = $1 AND m.notify = 'all' AND m.user_id <> $3
		  AND EXISTS (SELECT 1 FROM push_subscriptions d WHERE d.user_id = m.user_id)
		  AND NOT EXISTS (SELECT 1 FROM session_people h
			WHERE h.session_id = $2 AND h.user_id = m.user_id AND h.left_at IS NULL)
		  AND NOT EXISTS (SELECT 1 FROM notification_log l
			WHERE l.user_id = m.user_id AND l.crew_id = $1 AND l.kind = 'session.started' AND l.sent_at > now() - $4::interval)`,
		notice.CrewID, sessionID, notice.StarterID, pingCap)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// RecapAudience is the members who came, when at least two people did.
func (p *Postgres) RecapAudience(ctx context.Context, sessionID string, notice SessionNotice) ([]string, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT m.user_id FROM crew_members m
		JOIN session_people h ON h.session_id = $2 AND h.user_id = m.user_id
		WHERE m.crew_id = $1 AND m.notify = 'all'
		  AND EXISTS (SELECT 1 FROM push_subscriptions d WHERE d.user_id = m.user_id)
		  AND (SELECT count(*) FROM session_people WHERE session_id = $2) >= 2`, notice.CrewID, sessionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// ClaimNotification reserves this person's one send. False means it's taken, so a
// retried activity stops here.
func (p *Postgres) ClaimNotification(ctx context.Context, userID, crewID, kind, ref string) (bool, error) {
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO notification_log (user_id, crew_id, kind, ref) VALUES ($1, $2, $3, $4)
		ON CONFLICT DO NOTHING`, userID, crewID, kind, ref)
	return tag.RowsAffected() == 1, err
}

// ReleaseNotification gives a claim back when nothing reached the person.
func (p *Postgres) ReleaseNotification(ctx context.Context, userID, kind, ref string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM notification_log WHERE user_id = $1 AND kind = $2 AND ref = $3`, userID, kind, ref)
	return err
}

// PushTargets lists one person's browsers.
func (p *Postgres) PushTargets(ctx context.Context, userID string) ([]PushTarget, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PushTarget, error) {
		var target PushTarget
		return target, row.Scan(&target.ID, &target.Endpoint, &target.P256dh, &target.Auth)
	})
}

// DropPushTarget deletes a browser the push service says is gone.
func (p *Postgres) DropPushTarget(ctx context.Context, id string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE id = $1`, id)
	return err
}

// MarkPushOK records that a browser's service took a message.
func (p *Postgres) MarkPushOK(ctx context.Context, id string) error {
	_, err := p.pool.Exec(ctx, `UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1`, id)
	return err
}
