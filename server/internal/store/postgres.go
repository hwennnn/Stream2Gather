// Package store keeps durable data in Postgres and live room data in Redis.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"stream2gather/internal/room"
)

var (
	// ErrNotFound means the row does not exist.
	ErrNotFound = errors.New("not found")
	// ErrSlugTaken means another room already has this address.
	ErrSlugTaken = errors.New("slug taken")
)

// embedBlockDays is how long a reported embed block is believed. Owners change
// their minds, and a mistaken report must not last forever.
const embedBlockDays = 7

const uniqueViolation = "23505"

// Postgres runs durable queries.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres returns a store using pool.
func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Room is a room's durable record.
type Room struct {
	ID         string
	Slug       string
	Name       string
	OwnerID    string
	MaxMembers int
	ClosedAt   *time.Time
}

// EnsureUser creates a guest row on first use.
func (p *Postgres) EnsureUser(ctx context.Context, id, name string) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO users (id, kind, display_name) VALUES ($1, 'guest', $2)
		ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, last_seen_at = now()`,
		id, name)
	return err
}

// Account is the user behind a Clerk account.
type Account struct {
	ID             string
	Name           string
	SessionVersion int64
}

// LinkClerkUser returns the user behind a Clerk account, creating it on first
// sign-in. An account never takes over a guest's id, because anyone holding that
// guest's old cookie would then be the account too. The guest's rooms move to it
// instead, and only a real guest's: guestID may be anyone's.
func (p *Postgres) LinkClerkUser(ctx context.Context, clerkID, guestID, newID, name, avatar string) (Account, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback(ctx)

	var account Account
	err = tx.QueryRow(ctx, `
		INSERT INTO users (id, kind, clerk_id, display_name, avatar_url) VALUES ($1, 'clerk', $2, $3, $4)
		ON CONFLICT (clerk_id) DO UPDATE SET avatar_url = EXCLUDED.avatar_url, last_seen_at = now()
		RETURNING id, display_name, session_version`, newID, clerkID, name, avatar,
	).Scan(&account.ID, &account.Name, &account.SessionVersion)
	if err != nil {
		return Account{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE rooms SET owner_id = $1
		WHERE owner_id = $2 AND EXISTS (SELECT 1 FROM users WHERE id = $2 AND kind = 'guest')`, account.ID, guestID)
	if err != nil {
		return Account{}, err
	}
	return account, tx.Commit(ctx)
}

// SessionVersion returns the version a user's cookie must carry.
func (p *Postgres) SessionVersion(ctx context.Context, id string) (int64, error) {
	var version int64
	err := p.pool.QueryRow(ctx, `SELECT session_version FROM users WHERE id = $1`, id).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return version, err
}

// SessionVersions returns the versions of the users that still exist.
func (p *Postgres) SessionVersions(ctx context.Context, ids []string) (map[string]int64, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, session_version FROM users WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := make(map[string]int64, len(ids))
	for rows.Next() {
		var id string
		var version int64
		if err := rows.Scan(&id, &version); err != nil {
			return nil, err
		}
		versions[id] = version
	}
	return versions, rows.Err()
}

// BumpSessionVersion turns away every cookie issued to this user so far.
func (p *Postgres) BumpSessionVersion(ctx context.Context, id string) error {
	_, err := p.pool.Exec(ctx, `UPDATE users SET session_version = session_version + 1 WHERE id = $1`, id)
	return err
}

// CreateRoom inserts a room that expires after a day without use.
func (p *Postgres) CreateRoom(ctx context.Context, r Room) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO rooms (id, slug, name, owner_id, expires_at)
		VALUES ($1, $2, $3, $4, now() + interval '24 hours')`,
		r.ID, r.Slug, r.Name, r.OwnerID)
	var failure *pgconn.PgError
	if errors.As(err, &failure) && failure.Code == uniqueViolation && failure.ConstraintName == "rooms_slug_key" {
		return ErrSlugTaken
	}
	return err
}

// RoomBySlug finds a room by its address.
func (p *Postgres) RoomBySlug(ctx context.Context, slug string) (Room, error) {
	var r Room
	err := p.pool.QueryRow(ctx, `
		SELECT id, slug, name, owner_id, max_members, closed_at FROM rooms WHERE slug = $1`, slug,
	).Scan(&r.ID, &r.Slug, &r.Name, &r.OwnerID, &r.MaxMembers, &r.ClosedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Room{}, ErrNotFound
	}
	return r, err
}

// SaveSnapshot keeps the room's queue and position, and extends its life.
func (p *Postgres) SaveSnapshot(ctx context.Context, roomID string, state room.State) error {
	doc, err := json.Marshal(state)
	if err != nil {
		return err
	}
	_, err = p.pool.Exec(ctx, `
		UPDATE rooms SET snapshot = $2, updated_at = now(),
		       expires_at = CASE WHEN is_temporary THEN now() + interval '24 hours' END
		WHERE id = $1`, roomID, doc)
	return err
}

// LoadSnapshot returns the last saved state and when it was saved, or an empty
// room. Only SaveSnapshot writes updated_at.
func (p *Postgres) LoadSnapshot(ctx context.Context, roomID string) (room.State, time.Time, error) {
	var doc []byte
	var savedAt time.Time
	err := p.pool.QueryRow(ctx, `SELECT snapshot, updated_at FROM rooms WHERE id = $1`, roomID).Scan(&doc, &savedAt)
	if err != nil {
		return room.State{}, time.Time{}, fmt.Errorf("load snapshot: %w", err)
	}
	if doc == nil {
		return room.New(), savedAt, nil
	}
	var state room.State
	return state, savedAt, json.Unmarshal(doc, &state)
}

// Message is one chat line.
type Message struct {
	ID        int64     `json:"id"`
	UserID    string    `json:"userId"`
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

// InsertMessage stores a chat line.
func (p *Postgres) InsertMessage(ctx context.Context, roomID string, m Message) (Message, error) {
	err := p.pool.QueryRow(ctx, `
		INSERT INTO messages (room_id, user_id, author_name, body) VALUES ($1, $2, $3, $4)
		RETURNING id, created_at`, roomID, m.UserID, m.Author, m.Body,
	).Scan(&m.ID, &m.CreatedAt)
	return m, err
}

// Messages returns chat older than before, newest first. Zero means latest.
func (p *Postgres) Messages(ctx context.Context, roomID string, before int64, limit int) ([]Message, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, user_id, author_name, body, created_at FROM messages
		WHERE room_id = $1 AND ($2 = 0 OR id < $2)
		ORDER BY id DESC LIMIT $3`, roomID, before, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Message, error) {
		var m Message
		return m, row.Scan(&m.ID, &m.UserID, &m.Author, &m.Body, &m.CreatedAt)
	})
}

// GetMedia returns cached metadata if it is younger than maxAge.
func (p *Postgres) GetMedia(ctx context.Context, source, sourceID string, maxAge time.Duration) (room.Media, bool, error) {
	var m room.Media
	err := p.pool.QueryRow(ctx, `
		SELECT source, source_id, url, title, author, thumbnail_url, duration_ms, is_live
		FROM media WHERE source = $1 AND source_id = $2 AND fetched_at > $3`,
		source, sourceID, time.Now().Add(-maxAge),
	).Scan(&m.Source, &m.SourceID, &m.URL, &m.Title, &m.Author, &m.ThumbnailURL, &m.DurationMS, &m.IsLive)
	if errors.Is(err, pgx.ErrNoRows) {
		return room.Media{}, false, nil
	}
	return m, err == nil, err
}

// FreshMedia returns current metadata for what the state queues, leaving out
// whatever is gone or past the 30-day limit.
func (p *Postgres) FreshMedia(ctx context.Context, queue []room.Item) ([]room.Media, error) {
	sources, sourceIDs := make([]string, len(queue)), make([]string, len(queue))
	for i, item := range queue {
		sources[i], sourceIDs[i] = item.Source, item.SourceID
	}
	rows, err := p.pool.Query(ctx, `
		SELECT source, source_id, url, title, author, thumbnail_url, duration_ms, is_live
		FROM media WHERE (source, source_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
		  AND fetched_at > now() - interval '30 days'`, sources, sourceIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (room.Media, error) {
		var m room.Media
		return m, row.Scan(&m.Source, &m.SourceID, &m.URL, &m.Title, &m.Author, &m.ThumbnailURL, &m.DurationMS, &m.IsLive)
	})
}

// PutMedia stores fresh metadata. A known embed block is kept.
func (p *Postgres) PutMedia(ctx context.Context, items []room.Media) error {
	batch := &pgx.Batch{}
	for _, m := range items {
		batch.Queue(`
			INSERT INTO media (source, source_id, url, title, author, thumbnail_url, duration_ms, is_live)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (source, source_id) DO UPDATE SET
			  url = EXCLUDED.url, title = EXCLUDED.title, author = EXCLUDED.author,
			  thumbnail_url = EXCLUDED.thumbnail_url, duration_ms = EXCLUDED.duration_ms,
			  is_live = EXCLUDED.is_live, fetched_at = now()`,
			m.Source, m.SourceID, m.URL, m.Title, m.Author, m.ThumbnailURL, m.DurationMS, m.IsLive)
	}
	return p.pool.SendBatch(ctx, batch).Close()
}

// MarkEmbedBlocked remembers that a video refused to play in embedded players.
func (p *Postgres) MarkEmbedBlocked(ctx context.Context, source, sourceID string) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE media SET embed_blocked_at = now() WHERE source = $1 AND source_id = $2`, source, sourceID)
	return err
}

// EmbedBlocked returns which of the ids are known not to play when embedded.
func (p *Postgres) EmbedBlocked(ctx context.Context, source string, sourceIDs []string) (map[string]bool, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT source_id FROM media
		WHERE source = $1 AND source_id = ANY($2)
		  AND embed_blocked_at > now() - make_interval(days => $3)`, source, sourceIDs, embedBlockDays)
	if err != nil {
		return nil, err
	}
	blocked, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(blocked))
	for _, id := range blocked {
		out[id] = true
	}
	return out, nil
}

// CachedSearch returns stored results younger than maxAge.
func (p *Postgres) CachedSearch(ctx context.Context, source, query, region string, maxAge time.Duration) ([]room.Media, bool, error) {
	var ids []string
	err := p.pool.QueryRow(ctx, `
		SELECT media_ids FROM search_cache
		WHERE source = $1 AND query_norm = $2 AND region = $3 AND fetched_at > $4`,
		source, query, region, time.Now().Add(-maxAge),
	).Scan(&ids)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	rows, err := p.pool.Query(ctx, `
		SELECT source, m.source_id, url, title, author, thumbnail_url, duration_ms, is_live
		FROM unnest($2::text[]) WITH ORDINALITY AS wanted (source_id, position)
		JOIN media m ON m.source = $1 AND m.source_id = wanted.source_id
		WHERE NOT m.is_live
		  AND (m.embed_blocked_at IS NULL OR m.embed_blocked_at <= now() - make_interval(days => $3))
		ORDER BY wanted.position`, source, ids, embedBlockDays)
	if err != nil {
		return nil, false, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (room.Media, error) {
		var m room.Media
		return m, row.Scan(&m.Source, &m.SourceID, &m.URL, &m.Title, &m.Author, &m.ThumbnailURL, &m.DurationMS, &m.IsLive)
	})
	return items, err == nil, err
}

// PutSearch stores which media a query returned.
func (p *Postgres) PutSearch(ctx context.Context, source, query, region string, sourceIDs []string) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO search_cache (source, query_norm, region, media_ids) VALUES ($1, $2, $3, $4)
		ON CONFLICT (source, query_norm, region) DO UPDATE SET
		  media_ids = EXCLUDED.media_ids, fetched_at = now()`,
		source, query, region, sourceIDs)
	return err
}

// ReserveQuota spends one unit if the bucket has room today. YouTube's quota
// day follows Pacific time.
func (p *Postgres) ReserveQuota(ctx context.Context, bucket string, limit int) (bool, error) {
	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		return false, err
	}
	day := time.Now().In(location).Format("2006-01-02")

	var used int
	err = p.pool.QueryRow(ctx, `
		INSERT INTO quota_usage (day, bucket, used) VALUES ($1::date, $2, 1)
		ON CONFLICT (day, bucket) DO UPDATE SET used = quota_usage.used + 1
		WHERE quota_usage.used < $3
		RETURNING used`, day, bucket, limit,
	).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// StaleMedia returns ids of the oldest metadata past maxAge.
func (p *Postgres) StaleMedia(ctx context.Context, source string, maxAge time.Duration, limit int) ([]string, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT source_id FROM media WHERE source = $1 AND fetched_at < $2
		ORDER BY fetched_at LIMIT $3`, source, time.Now().Add(-maxAge), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// DeleteMedia removes metadata that can no longer be refreshed.
func (p *Postgres) DeleteMedia(ctx context.Context, source string, sourceIDs []string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM media WHERE source = $1 AND source_id = ANY($2)`, source, sourceIDs)
	return err
}

// SavedRoom is a permanent room's saved state.
type SavedRoom struct {
	ID    string
	State room.State
}

// DueSnapshots returns permanent rooms whose saved titles are close to the 30-day
// limit, oldest first.
func (p *Postgres) DueSnapshots(ctx context.Context, limit int) ([]SavedRoom, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, snapshot FROM rooms
		WHERE closed_at IS NULL AND NOT is_temporary AND snapshot IS NOT NULL
		  AND coalesce(snapshot_checked_at, created_at) < now() - interval '20 days'
		ORDER BY coalesce(snapshot_checked_at, created_at) LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (SavedRoom, error) {
		var saved SavedRoom
		var doc []byte
		if err := row.Scan(&saved.ID, &doc); err != nil {
			return saved, err
		}
		return saved, json.Unmarshal(doc, &saved.State)
	})
}

// PutCheckedSnapshot stores a state whose titles have just been checked. It leaves
// updated_at alone: that says when the room's position was saved.
func (p *Postgres) PutCheckedSnapshot(ctx context.Context, roomID string, state room.State) error {
	doc, err := json.Marshal(state)
	if err != nil {
		return err
	}
	_, err = p.pool.Exec(ctx, `UPDATE rooms SET snapshot = $2, snapshot_checked_at = now() WHERE id = $1`, roomID, doc)
	return err
}

// CountStaleMedia says how much metadata is past maxAge, so past due for a refresh.
func (p *Postgres) CountStaleMedia(ctx context.Context, source string, maxAge time.Duration) (int64, error) {
	var count int64
	err := p.pool.QueryRow(ctx, `
		SELECT count(*) FROM media WHERE source = $1 AND fetched_at < $2`, source, time.Now().Add(-maxAge),
	).Scan(&count)
	return count, err
}

// PurgeSearches drops cached result lists no reader would accept any more.
func (p *Postgres) PurgeSearches(ctx context.Context, maxAge time.Duration) (int64, error) {
	tag, err := p.pool.Exec(ctx, `DELETE FROM search_cache WHERE fetched_at < $1`, time.Now().Add(-maxAge))
	return tag.RowsAffected(), err
}

// CloseExpiredRooms ends temporary rooms nobody has used, and reports how many.
// A closed room never reopens, so its snapshot and the titles in it go too.
func (p *Postgres) CloseExpiredRooms(ctx context.Context) (int64, error) {
	tag, err := p.pool.Exec(ctx, `
		UPDATE rooms SET closed_at = now(), snapshot = NULL WHERE closed_at IS NULL AND expires_at < now()`)
	return tag.RowsAffected(), err
}
