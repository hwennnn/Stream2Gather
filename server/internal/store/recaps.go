package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"stream2gather/internal/recap"
)

// querier is the pool or a transaction.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func recapInput(ctx context.Context, q querier, sessionID string) (recap.Input, error) {
	var in recap.Input
	err := q.QueryRow(ctx, `
		SELECT (extract(epoch FROM ended_at - started_at) * 1000)::bigint FROM crew_sessions
		WHERE id = $1 AND ended_at IS NOT NULL`, sessionID).Scan(&in.WallMs)
	if err != nil {
		return in, err
	}
	rows, err := q.Query(ctx, `
		SELECT display_name, is_guest FROM session_people WHERE session_id = $1 ORDER BY joined_at, user_id`, sessionID)
	if err != nil {
		return in, err
	}
	in.People, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (recap.Person, error) {
		var person recap.Person
		return person, row.Scan(&person.Name, &person.IsGuest)
	})
	if err != nil {
		return in, err
	}
	rows, err = q.Query(ctx, `
		SELECT source, coalesce(source_id, '') FROM session_items WHERE session_id = $1 ORDER BY id`, sessionID)
	if err != nil {
		return in, err
	}
	in.Videos, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (recap.Video, error) {
		var video recap.Video
		return video, row.Scan(&video.Source, &video.SourceID)
	})
	if err != nil {
		return in, err
	}
	rows, err = q.Query(ctx, `
		SELECT source, source_id, pos_ms, kind, coalesce(user_id, ''), coalesce(emoji, '')
		FROM moments WHERE session_id = $1 AND origin = 'live'`, sessionID)
	if err != nil {
		return in, err
	}
	in.Moments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (recap.Moment, error) {
		var m recap.Moment
		return m, row.Scan(&m.Source, &m.SourceID, &m.PosMs, &m.Kind, &m.UserID, &m.Emoji)
	})
	return in, err
}

// SessionReactions reads where the room's reactions landed. A catch-up's aren't part of the night.
func (p *Postgres) SessionReactions(ctx context.Context, sessionID string) ([]recap.Moment, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT source, source_id, pos_ms, coalesce(user_id, '')
		FROM moments WHERE session_id = $1 AND origin = 'live' AND kind = 'reaction'
		ORDER BY pos_ms, id`, sessionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (recap.Moment, error) {
		m := recap.Moment{Kind: recap.KindReaction}
		return m, row.Scan(&m.Source, &m.SourceID, &m.PosMs, &m.UserID)
	})
}

// BuildRecap writes a finished session's recap. Running it again replaces the doc
// and tells nobody twice. A session of one tells nobody at all.
func (p *Postgres) BuildRecap(ctx context.Context, sessionID string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	people, err := writeRecap(ctx, tx, sessionID)
	if err != nil {
		return err
	}
	if people > 1 {
		tag, err := tx.Exec(ctx, `
			INSERT INTO outbox (kind, ref) SELECT 'recap.ready', $1
			WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE kind = 'recap.ready' AND ref = $1)`, sessionID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			if _, err := tx.Exec(ctx, `SELECT pg_notify('outbox', '')`); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func writeRecap(ctx context.Context, tx pgx.Tx, sessionID string) (people int, err error) {
	in, err := recapInput(ctx, tx, sessionID)
	if err != nil {
		return 0, fmt.Errorf("read session: %w", err)
	}
	doc, err := json.Marshal(recap.Build(in))
	if err != nil {
		return 0, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO session_recaps (session_id, doc) VALUES ($1, $2)
		ON CONFLICT (session_id) DO UPDATE SET doc = excluded.doc, built_at = now()`, sessionID, doc)
	return len(in.People), err
}

// rebuildRecaps rewrites recaps that already exist, after what they were built
// from has been taken away.
func rebuildRecaps(ctx context.Context, tx pgx.Tx, sessionIDs []string) error {
	rows, err := tx.Query(ctx, `SELECT session_id FROM session_recaps WHERE session_id = ANY($1)`, sessionIDs)
	if err != nil {
		return err
	}
	built, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, sessionID := range built {
		if _, err := writeRecap(ctx, tx, sessionID); err != nil {
			return err
		}
	}
	return nil
}

// UnbuiltSessions finds finished sessions with no recap yet, oldest first.
func (p *Postgres) UnbuiltSessions(ctx context.Context, limit int) ([]string, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT s.id FROM crew_sessions s
		LEFT JOIN session_recaps r ON r.session_id = s.id
		WHERE s.ended_at IS NOT NULL AND r.session_id IS NULL
		ORDER BY s.ended_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// SessionRecap is a stored recap. Doc is nil while it hasn't been built.
type SessionRecap struct {
	SessionID  string
	CrewName   string
	StartedAt  time.Time
	Doc        *recap.Doc
	ShareToken string
}

func scanRecap(row pgx.Row) (SessionRecap, error) {
	var r SessionRecap
	var doc []byte
	var token *string
	if err := row.Scan(&r.SessionID, &r.CrewName, &r.StartedAt, &doc, &token); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return r, ErrNotFound
		}
		return r, err
	}
	if token != nil {
		r.ShareToken = *token
	}
	if doc != nil {
		r.Doc = &recap.Doc{}
		return r, json.Unmarshal(doc, r.Doc)
	}
	return r, nil
}

const recapColumns = `
	SELECT s.id, rm.name, s.started_at, r.doc, r.share_token
	FROM crew_sessions s
	JOIN crews c ON c.id = s.crew_id
	JOIN rooms rm ON rm.id = c.room_id
	LEFT JOIN session_recaps r ON r.session_id = s.id`

// RecapOf finds one of a crew's finished sessions, built or not.
func (p *Postgres) RecapOf(ctx context.Context, crewID, sessionID string) (SessionRecap, error) {
	return scanRecap(p.pool.QueryRow(ctx, recapColumns+`
		WHERE s.id = $1 AND s.crew_id = $2 AND s.ended_at IS NOT NULL`, sessionID, crewID))
}

// RecapByToken finds a shared recap. A revoked token finds nothing.
func (p *Postgres) RecapByToken(ctx context.Context, token string) (SessionRecap, error) {
	return scanRecap(p.pool.QueryRow(ctx, recapColumns+` WHERE r.share_token = $1`, token))
}

// ShareRecap sets the recap's public token, or takes it away when token is "".
func (p *Postgres) ShareRecap(ctx context.Context, sessionID, token string) error {
	var value *string
	if token != "" {
		value = &token
	}
	tag, err := p.pool.Exec(ctx, `UPDATE session_recaps SET share_token = $2 WHERE session_id = $1`, sessionID, value)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// Attended reports whether someone was at a session.
func (p *Postgres) Attended(ctx context.Context, sessionID, userID string) (bool, error) {
	var here bool
	err := p.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM session_people WHERE session_id = $1 AND user_id = $2)`, sessionID, userID).Scan(&here)
	return here, err
}

// SessionItemOf finds the first time a session played a video, for linking to it.
func (p *Postgres) SessionItemOf(ctx context.Context, sessionID, source, sourceID string) (int64, error) {
	var id *int64
	err := p.pool.QueryRow(ctx, `
		SELECT min(id) FROM session_items WHERE session_id = $1 AND source = $2 AND source_id = $3`,
		sessionID, source, sourceID).Scan(&id)
	if err != nil || id == nil {
		return 0, err
	}
	return *id, nil
}
