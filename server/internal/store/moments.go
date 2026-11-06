package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// VideoMoment is one reaction or chat line at a position in a video.
type VideoMoment struct {
	ID     int64  `json:"id"`
	PosMs  int64  `json:"posMs"`
	Kind   string `json:"kind"`
	Origin string `json:"origin"`
	Author string `json:"author"`
	Emoji  string `json:"emoji,omitempty"`
	Body   string `json:"body,omitempty"`
}

// MomentRange picks moments between two positions, after a page's last row.
type MomentRange struct {
	FromMs, ToMs      int64
	AfterPos, AfterID int64
	Limit             int
}

// VideoMoments reads a video's moments across all of a crew's sessions, in order.
func (p *Postgres) VideoMoments(ctx context.Context, crewID, source, sourceID string, span MomentRange) ([]VideoMoment, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT m.id, m.pos_ms, m.kind, m.origin, m.author_name, coalesce(m.emoji, ''), coalesce(c.body, '')
		FROM moments m LEFT JOIN messages c ON c.id = m.message_id
		WHERE m.crew_id = $1 AND m.source = $2 AND m.source_id = $3
			AND m.pos_ms >= $4 AND m.pos_ms < $5 AND (m.pos_ms, m.id) > ($6, $7)
		ORDER BY m.pos_ms, m.id LIMIT $8`,
		crewID, source, sourceID, span.FromMs, span.ToMs, span.AfterPos, span.AfterID, span.Limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (VideoMoment, error) {
		var m VideoMoment
		return m, row.Scan(&m.ID, &m.PosMs, &m.Kind, &m.Origin, &m.Author, &m.Emoji, &m.Body)
	})
}

// CrewItem finds something a crew's session played. A purged video has no source id.
func (p *Postgres) CrewItem(ctx context.Context, crewID string, itemID int64) (source, sourceID string, err error) {
	err = p.pool.QueryRow(ctx, `
		SELECT i.source, coalesce(i.source_id, '') FROM session_items i
		JOIN crew_sessions s ON s.id = i.session_id
		WHERE i.id = $1 AND s.crew_id = $2`, itemID, crewID).Scan(&source, &sourceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return source, sourceID, err
}

// CrewWatched reports whether any of a crew's sessions played this video.
func (p *Postgres) CrewWatched(ctx context.Context, crewID, source, sourceID string) (bool, error) {
	var watched bool
	err := p.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM session_items i JOIN crew_sessions s ON s.id = i.session_id
			WHERE s.crew_id = $1 AND i.source = $2 AND i.source_id = $3)`, crewID, source, sourceID).Scan(&watched)
	return watched, err
}

// CatchupMoment is a reaction or chat line left by someone watching later.
type CatchupMoment struct {
	CrewID, RoomID   string
	Source, SourceID string
	PosMs            int64
	UserID, Author   string
	Emoji, Body      string
}

// AddCatchupMoment stores it for the next person. A chat line gets a messages row,
// as a live one has, but stays out of the room: see visibleInRoom.
func (p *Postgres) AddCatchupMoment(ctx context.Context, m CatchupMoment) (int64, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	kind := "reaction"
	var emoji *string
	var messageID *int64
	if m.Body == "" {
		emoji = &m.Emoji
	} else {
		kind = "chat"
		messageID = new(int64)
		err := tx.QueryRow(ctx, `
			INSERT INTO messages (room_id, user_id, author_name, body) VALUES ($1, $2, $3, $4) RETURNING id`,
			m.RoomID, m.UserID, m.Author, m.Body).Scan(messageID)
		if err != nil {
			return 0, err
		}
	}
	var id int64
	err = tx.QueryRow(ctx, `
		INSERT INTO moments (crew_id, source, source_id, pos_ms, kind, origin, user_id, author_name, emoji, message_id)
		VALUES ($1, $2, $3, $4, $5, 'catchup', $6, $7, $8, $9) RETURNING id`,
		m.CrewID, m.Source, m.SourceID, m.PosMs, kind, m.UserID, m.Author, emoji, messageID).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, tx.Commit(ctx)
}
