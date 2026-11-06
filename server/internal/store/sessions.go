package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"stream2gather/internal/ids"
)

// CapturedMoment is a reaction or chat line, placed in the video it happened in.
type CapturedMoment struct {
	Kind      string
	UserID    string
	Author    string
	Emoji     string
	MessageID int64
	Source    string
	SourceID  string
	PosMs     int64
	At        time.Time
}

// Capture is what one crew room did since the last flush.
type Capture struct {
	CrewID string
	At     time.Time
	// Playing opens a session if none is open. Nothing else does.
	Playing bool
	// Source and SourceID are what's on now, and empty when nothing is.
	Source   string
	SourceID string
	// Present is everyone here, seated when this flush opens the session.
	Present []Person
	Joined  []Person
	Left    []string
	// Active keeps the session from timing out.
	Active  bool
	Moments []CapturedMoment
}

// CrewIDOfRoom returns the room's crew, or "" for a room without one.
func (p *Postgres) CrewIDOfRoom(ctx context.Context, roomID string) (string, error) {
	var id string
	err := p.pool.QueryRow(ctx, `SELECT id FROM crews WHERE room_id = $1`, roomID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// RecordCapture writes one flush in one transaction, so a session never opens
// without its outbox row.
func (p *Postgres) RecordCapture(ctx context.Context, c Capture) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	sessionID, err := currentSession(ctx, tx, c)
	if err != nil {
		return err
	}
	if sessionID != "" {
		if err := seat(ctx, tx, sessionID, c.Joined, c.At); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// currentSession finds the open session, opening one if the room is playing.
// The unique index settles two servers opening at once: the loser finds the winner's.
func currentSession(ctx context.Context, tx pgx.Tx, c Capture) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM crew_sessions WHERE crew_id = $1 AND ended_at IS NULL`, c.CrewID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if !c.Playing {
		return "", nil
	}
	id = ids.New()
	tag, err := tx.Exec(ctx, `
		INSERT INTO crew_sessions (id, crew_id, started_by, started_at, last_activity_at)
		VALUES ($1, $2, (SELECT m.user_id FROM crew_members m WHERE m.crew_id = $2 AND m.user_id = ANY($3) ORDER BY m.joined_at LIMIT 1), $4, $4)
		ON CONFLICT (crew_id) WHERE ended_at IS NULL DO NOTHING`, id, c.CrewID, personIDs(c.Present), c.At)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		err := tx.QueryRow(ctx, `SELECT id FROM crew_sessions WHERE crew_id = $1 AND ended_at IS NULL`, c.CrewID).Scan(&id)
		return id, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO outbox (kind, ref) VALUES ('session.started', $1)`, id); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('outbox', '')`); err != nil {
		return "", err
	}
	return id, seat(ctx, tx, id, c.Present, c.At)
}

func personIDs(people []Person) []string {
	userIDs := make([]string, len(people))
	for i, person := range people {
		userIDs[i] = person.UserID
	}
	return userIDs
}

// seat adds people to a session, or brings them back to it.
func seat(ctx context.Context, tx pgx.Tx, sessionID string, people []Person, at time.Time) error {
	for _, person := range people {
		_, err := tx.Exec(ctx, `
			INSERT INTO session_people (session_id, user_id, display_name, is_guest, joined_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (session_id, user_id) DO UPDATE SET left_at = NULL, display_name = excluded.display_name`,
			sessionID, person.UserID, person.Name, !person.Member, at)
		if err != nil {
			return err
		}
	}
	return nil
}
