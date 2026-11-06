package store

import (
	"context"
	"encoding/json"
	"fmt"

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
