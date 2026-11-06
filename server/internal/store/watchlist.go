package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"stream2gather/internal/room"
)

// MaxWatchlist is how many videos a crew can have lined up.
const MaxWatchlist = 200

// ErrWatchlistFull means the crew has nowhere to put another video.
var ErrWatchlistFull = errors.New("watchlist is full")

// WatchItem is one video a crew means to watch. Only its ids are stored; Media is
// joined on every read, and is nil once the source's data has gone or aged out.
type WatchItem struct {
	ID       int64     `json:"id"`
	Source   string    `json:"source"`
	SourceID string    `json:"sourceId"`
	AddedAt  time.Time `json:"addedAt"`
	// AddedBy is nil once the account that added it has gone.
	AddedBy *WatchAdder `json:"addedBy"`
	Media   *room.Media `json:"media"`
}

// WatchAdder is the friend a video on the list came from.
type WatchAdder struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
}

// freshMedia scans a LEFT JOIN on media, which finds nothing once the data has
// gone or aged out.
type freshMedia struct {
	url, title, author, thumbnail *string
	duration                      *int64
	live                          *bool
}

func (f freshMedia) media(source, sourceID string) *room.Media {
	if f.url == nil {
		return nil
	}
	return &room.Media{
		Source: source, SourceID: sourceID, URL: *f.url, Title: *f.title,
		Author: *f.author, ThumbnailURL: *f.thumbnail, DurationMS: *f.duration, IsLive: *f.live,
	}
}

// AddWatch lines a video up. Adding one that's there already changes nothing, and
// adding one the crew has watched puts it back.
func (p *Postgres) AddWatch(ctx context.Context, crewID, source, sourceID, addedBy string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// The lock makes two adds take turns, so neither finds the last place empty.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM crews WHERE id = $1 FOR UPDATE`, crewID); err != nil {
		return err
	}
	var count int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM watchlist_items WHERE crew_id = $1 AND removed_at IS NULL AND watched_session_id IS NULL`, crewID).Scan(&count)
	if err != nil {
		return err
	}
	if count >= MaxWatchlist {
		return ErrWatchlistFull
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO watchlist_items (crew_id, source, source_id, added_by) VALUES ($1, $2, $3, $4)
		ON CONFLICT (crew_id, source, source_id) WHERE removed_at IS NULL
		DO UPDATE SET watched_session_id = NULL WHERE watchlist_items.watched_session_id IS NOT NULL`,
		crewID, source, sourceID, addedBy)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Watchlist returns what the crew hasn't watched yet, oldest idea first.
func (p *Postgres) Watchlist(ctx context.Context, crewID string) ([]WatchItem, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT w.id, w.source, w.source_id, w.added_at, u.id, u.display_name,
		       m.url, m.title, m.author, m.thumbnail_url, m.duration_ms, m.is_live
		FROM watchlist_items w
		LEFT JOIN users u ON u.id = w.added_by
		LEFT JOIN media m ON m.source = w.source AND m.source_id = w.source_id
		                 AND m.fetched_at > now() - interval '30 days'
		WHERE w.crew_id = $1 AND w.removed_at IS NULL AND w.watched_session_id IS NULL
		ORDER BY w.id`, crewID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (WatchItem, error) {
		var item WatchItem
		var fresh freshMedia
		var adderID, adderName *string
		err := row.Scan(&item.ID, &item.Source, &item.SourceID, &item.AddedAt, &adderID, &adderName, &fresh.url, &fresh.title, &fresh.author, &fresh.thumbnail, &fresh.duration, &fresh.live)
		item.Media = fresh.media(item.Source, item.SourceID)
		if adderID != nil && adderName != nil {
			item.AddedBy = &WatchAdder{UserID: *adderID, Name: *adderName}
		}
		return item, err
	})
}

// RemoveWatch takes a video off the list, and reports whether it was on it.
func (p *Postgres) RemoveWatch(ctx context.Context, crewID string, id int64) (bool, error) {
	tag, err := p.pool.Exec(ctx, `
		UPDATE watchlist_items SET removed_at = now() WHERE id = $1 AND crew_id = $2 AND removed_at IS NULL`, id, crewID)
	return tag.RowsAffected() > 0, err
}
