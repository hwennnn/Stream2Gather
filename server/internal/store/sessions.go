package store

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
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

// WatchedAfter is how much unbroken play ticks a video off the list, with a member
// there for it. Too high costs a stray row someone can remove. Too low hides a video
// nobody watched, so this errs high. It's only a number, and no data depends on it.
const WatchedAfter = 30 * time.Second

// PlayedRun is one unbroken stretch of a video playing.
type PlayedRun struct {
	Source   string
	SourceID string
	From     time.Time
	To       time.Time
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
	// PressedPlay is who started it, named on the session if they're a member. Empty
	// when nobody in this flush did, and then the session names nobody.
	PressedPlay string
	// Present is everyone here, seated when this flush opens the session.
	Present []Person
	Joined  []Person
	Left    []string
	// Played is what ran long enough to count as watched.
	Played []PlayedRun
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

	// Users before sessions, as in DeleteAccount, so the two can't deadlock.
	c, err = withoutDeleted(ctx, tx, c)
	if err != nil {
		return err
	}
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

// withoutDeleted drops anyone whose account has gone. A socket outlives its
// account by up to one session check, and their name mustn't return with it. The
// lock makes a deletion wait for this flush, so it can clean up after it too.
func withoutDeleted(ctx context.Context, tx pgx.Tx, c Capture) (Capture, error) {
	mentioned := append(personIDs(c.Present), personIDs(c.Joined)...)
	for _, moment := range c.Moments {
		mentioned = append(mentioned, moment.UserID)
	}
	if c.PressedPlay != "" {
		mentioned = append(mentioned, c.PressedPlay)
	}
	if len(mentioned) == 0 {
		return c, nil
	}
	rows, err := tx.Query(ctx, `SELECT id FROM users WHERE id = ANY($1) FOR KEY SHARE`, mentioned)
	if err != nil {
		return c, err
	}
	found, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return c, err
	}
	gone := func(id string) bool { return !slices.Contains(found, id) }
	personGone := func(p Person) bool { return gone(p.UserID) }
	c.Present = slices.DeleteFunc(slices.Clone(c.Present), personGone)
	c.Joined = slices.DeleteFunc(slices.Clone(c.Joined), personGone)
	c.Moments = slices.DeleteFunc(slices.Clone(c.Moments), func(m CapturedMoment) bool { return gone(m.UserID) })
	return c, nil
}

// currentSession finds the open session, opening one if the room is playing.
// The unique index settles two servers opening at once: the loser finds the
// winner's. The lock keeps the sweeper from ending a session mid-flush, which
// would leave what this flush opens running in it for good.
func currentSession(ctx context.Context, tx pgx.Tx, c Capture) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM crew_sessions WHERE crew_id = $1 AND ended_at IS NULL FOR UPDATE`, c.CrewID).Scan(&id)
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
		VALUES ($1, $2, (SELECT m.user_id FROM crew_members m WHERE m.crew_id = $2 AND m.user_id = $3), $4, $4)
		ON CONFLICT (crew_id) WHERE ended_at IS NULL DO NOTHING`, id, c.CrewID, c.PressedPlay, c.At)
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
	if err := tickWatched(ctx, tx, sessionID, c); err != nil {
		return err
	}
	if !c.Active {
		return nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE crew_sessions SET last_activity_at = greatest(last_activity_at, $2) WHERE id = $1`, sessionID, c.At)
	return err
}

// recordItem starts a row when the video changes.
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
	return err
}

// tickWatched marks a video watched once a member was here for enough of it playing.
// A video left paused, or played to a room of guests, stays on the list.
func tickWatched(ctx context.Context, tx pgx.Tx, sessionID string, c Capture) error {
	for _, run := range c.Played {
		_, err := tx.Exec(ctx, `
			UPDATE watchlist_items SET watched_session_id = $1
			WHERE crew_id = $2 AND source = $3 AND source_id = $4 AND removed_at IS NULL AND watched_session_id IS NULL
			  AND EXISTS (SELECT 1 FROM session_people h WHERE h.session_id = $1 AND NOT h.is_guest
				AND least(coalesce(h.left_at, $6::timestamptz), $6::timestamptz) - greatest(h.joined_at, $5::timestamptz) >= $7::interval)`,
			sessionID, c.CrewID, run.Source, run.SourceID, run.From, run.To, WatchedAfter)
		if err != nil {
			return err
		}
	}
	return nil
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

// purgeMediaRefs forgets a video that has left media. A session keeps its row, so
// it still says that something was on.
func purgeMediaRefs(ctx context.Context, tx pgx.Tx, source string, sourceIDs []string) error {
	for _, statement := range []string{
		`DELETE FROM watchlist_items WHERE source = $1 AND source_id = ANY($2)`,
		`DELETE FROM moments WHERE source = $1 AND source_id = ANY($2)`,
		`UPDATE session_items SET source_id = NULL WHERE source = $1 AND source_id = ANY($2)`,
	} {
		if _, err := tx.Exec(ctx, statement, source, sourceIDs); err != nil {
			return err
		}
	}
	return nil
}

// OpenSessionStart says when the room's running session began, if one is running.
func (p *Postgres) OpenSessionStart(ctx context.Context, roomID string) (time.Time, bool, error) {
	var at time.Time
	err := p.pool.QueryRow(ctx, `
		SELECT s.started_at FROM crew_sessions s JOIN crews c ON c.id = s.crew_id
		WHERE c.room_id = $1 AND s.ended_at IS NULL`, roomID).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	return at, err == nil, err
}

// SessionPerson is someone at a watch party.
type SessionPerson struct {
	Name    string `json:"name"`
	IsGuest bool   `json:"isGuest"`
}

// SessionVideo is one thing a session watched. Media is joined fresh and is nil
// once the source's data has gone or aged out.
type SessionVideo struct {
	Source   string      `json:"source"`
	SourceID string      `json:"sourceId,omitempty"`
	Media    *room.Media `json:"media"`
}

// PastSession is one finished watch party.
type PastSession struct {
	ID        string          `json:"id"`
	StartedAt time.Time       `json:"startedAt"`
	EndedAt   time.Time       `json:"endedAt"`
	People    []SessionPerson `json:"people"`
	Videos    []SessionVideo  `json:"videos"`
}

// CrewSessions returns finished sessions started before a moment, newest first.
func (p *Postgres) CrewSessions(ctx context.Context, crewID string, before time.Time, limit int) ([]PastSession, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, started_at, ended_at FROM crew_sessions
		WHERE crew_id = $1 AND ended_at IS NOT NULL AND started_at < $2
		ORDER BY started_at DESC LIMIT $3`, crewID, before, limit)
	if err != nil {
		return nil, err
	}
	sessions, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (PastSession, error) {
		s := PastSession{People: []SessionPerson{}, Videos: []SessionVideo{}}
		return s, row.Scan(&s.ID, &s.StartedAt, &s.EndedAt)
	})
	if err != nil || len(sessions) == 0 {
		return sessions, err
	}
	byID := make(map[string]*PastSession, len(sessions))
	sessionIDs := make([]string, len(sessions))
	for i := range sessions {
		byID[sessions[i].ID] = &sessions[i]
		sessionIDs[i] = sessions[i].ID
	}
	if err := p.sessionPeople(ctx, sessionIDs, byID); err != nil {
		return nil, err
	}
	return sessions, p.sessionVideos(ctx, sessionIDs, byID)
}

func (p *Postgres) sessionPeople(ctx context.Context, sessionIDs []string, byID map[string]*PastSession) error {
	rows, err := p.pool.Query(ctx, `
		SELECT session_id, display_name, is_guest FROM session_people
		WHERE session_id = ANY($1) ORDER BY joined_at, user_id`, sessionIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var sessionID string
		var person SessionPerson
		if err := rows.Scan(&sessionID, &person.Name, &person.IsGuest); err != nil {
			return err
		}
		byID[sessionID].People = append(byID[sessionID].People, person)
	}
	return rows.Err()
}

func (p *Postgres) sessionVideos(ctx context.Context, sessionIDs []string, byID map[string]*PastSession) error {
	rows, err := p.pool.Query(ctx, `
		SELECT i.session_id, i.source, coalesce(i.source_id, ''),
		       m.url, m.title, m.author, m.thumbnail_url, m.duration_ms, m.is_live
		FROM session_items i
		LEFT JOIN media m ON m.source = i.source AND m.source_id = i.source_id
		                 AND m.fetched_at > now() - interval '30 days'
		WHERE i.session_id = ANY($1) ORDER BY i.id`, sessionIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var sessionID string
		var video SessionVideo
		var fresh freshMedia
		if err := rows.Scan(&sessionID, &video.Source, &video.SourceID, &fresh.url, &fresh.title, &fresh.author, &fresh.thumbnail, &fresh.duration, &fresh.live); err != nil {
			return err
		}
		video.Media = fresh.media(video.Source, video.SourceID)
		byID[sessionID].Videos = append(byID[sessionID].Videos, video)
	}
	return rows.Err()
}

// SecondSessions counts crews whose first session is at least 14 days old, and
// how many of those held another within 14 days of it.
func (p *Postgres) SecondSessions(ctx context.Context) (cohort, returned int64, err error) {
	err = p.pool.QueryRow(ctx, `
		WITH firsts AS (
		  SELECT crew_id, min(started_at) AS first FROM crew_sessions
		  GROUP BY crew_id HAVING min(started_at) <= now() - interval '14 days')
		SELECT count(*), count(*) FILTER (WHERE EXISTS (
		  SELECT 1 FROM crew_sessions s
		  WHERE s.crew_id = f.crew_id AND s.started_at > f.first AND s.started_at <= f.first + interval '14 days'))
		FROM firsts f`).Scan(&cohort, &returned)
	return cohort, returned, err
}
