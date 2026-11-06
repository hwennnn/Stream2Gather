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
		if err := recordSession(ctx, tx, sessionID, c); err != nil {
			return err
		}
	}
	if err := recordMoments(ctx, tx, sessionID, c); err != nil {
		return err
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

func recordSession(ctx context.Context, tx pgx.Tx, sessionID string, c Capture) error {
	if err := seat(ctx, tx, sessionID, c.Joined, c.At); err != nil {
		return err
	}
	if len(c.Left) > 0 {
		_, err := tx.Exec(ctx, `
			UPDATE session_people SET left_at = $3
			WHERE session_id = $1 AND user_id = ANY($2) AND left_at IS NULL`, sessionID, c.Left, c.At)
		if err != nil {
			return err
		}
	}
	if err := recordItem(ctx, tx, sessionID, c); err != nil {
		return err
	}
	if !c.Active {
		return nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE crew_sessions SET last_activity_at = greatest(last_activity_at, $2) WHERE id = $1`, sessionID, c.At)
	return err
}

// recordItem starts a row when the video changes, and marks it watched on the list.
func recordItem(ctx context.Context, tx pgx.Tx, sessionID string, c Capture) error {
	var itemID int64
	var source string
	var sourceID *string
	err := tx.QueryRow(ctx, `
		SELECT id, source, source_id FROM session_items
		WHERE session_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1`, sessionID).Scan(&itemID, &source, &sourceID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	open := err == nil
	if open && source == c.Source && sourceID != nil && *sourceID == c.SourceID {
		return nil
	}
	if open {
		if _, err := tx.Exec(ctx, `UPDATE session_items SET ended_at = $2 WHERE id = $1`, itemID, c.At); err != nil {
			return err
		}
	}
	if c.SourceID == "" {
		return nil
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO session_items (session_id, source, source_id, started_at) VALUES ($1, $2, $3, $4)`,
		sessionID, c.Source, c.SourceID, c.At)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE watchlist_items SET watched_session_id = $1
		WHERE crew_id = $2 AND source = $3 AND source_id = $4 AND removed_at IS NULL AND watched_session_id IS NULL`,
		sessionID, c.CrewID, c.Source, c.SourceID)
	return err
}

func recordMoments(ctx context.Context, tx pgx.Tx, sessionID string, c Capture) error {
	if len(c.Moments) == 0 {
		return nil
	}
	var session *string
	if sessionID != "" {
		session = &sessionID
	}
	rows := make([][]any, len(c.Moments))
	for i, m := range c.Moments {
		var emoji *string
		if m.Emoji != "" {
			emoji = &m.Emoji
		}
		var messageID *int64
		if m.MessageID != 0 {
			messageID = &m.MessageID
		}
		rows[i] = []any{c.CrewID, session, m.Source, m.SourceID, m.PosMs, m.Kind, m.UserID, m.Author, emoji, messageID, m.At}
	}
	_, err := tx.CopyFrom(ctx, pgx.Identifier{"moments"},
		[]string{"crew_id", "session_id", "source", "source_id", "pos_ms", "kind", "user_id", "author_name", "emoji", "message_id", "at"},
		pgx.CopyFromRows(rows))
	return err
}

// OpenSession is a session the sweeper has to decide about.
type OpenSession struct {
	ID           string
	RoomID       string
	LastActivity time.Time
	// LastLeft is when someone last left, and zero if nobody has.
	LastLeft time.Time
}

// OpenSessions lists every session still running.
func (p *Postgres) OpenSessions(ctx context.Context) ([]OpenSession, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT s.id, c.room_id, s.last_activity_at,
		       coalesce((SELECT max(left_at) FROM session_people WHERE session_id = s.id), 'epoch')
		FROM crew_sessions s JOIN crews c ON c.id = s.crew_id
		WHERE s.ended_at IS NULL`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (OpenSession, error) {
		var s OpenSession
		return s, row.Scan(&s.ID, &s.RoomID, &s.LastActivity, &s.LastLeft)
	})
}

// TouchSession records that a session is still going, for a video nobody touches.
func (p *Postgres) TouchSession(ctx context.Context, sessionID string, at time.Time) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE crew_sessions SET last_activity_at = greatest(last_activity_at, $2) WHERE id = $1`, sessionID, at)
	return err
}

// EndSession closes a session and everything left open in it, including what a
// crashed server never got to close. It reports false if it had ended already.
func (p *Postgres) EndSession(ctx context.Context, sessionID string, at time.Time) (bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE crew_sessions SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL`, sessionID, at)
	if err != nil || tag.RowsAffected() == 0 {
		return false, err
	}
	for _, statement := range []string{
		`UPDATE session_items SET ended_at = $2 WHERE session_id = $1 AND ended_at IS NULL`,
		`UPDATE session_people SET left_at = $2 WHERE session_id = $1 AND left_at IS NULL`,
	} {
		if _, err := tx.Exec(ctx, statement, sessionID, at); err != nil {
			return false, err
		}
	}
	return true, tx.Commit(ctx)
}
