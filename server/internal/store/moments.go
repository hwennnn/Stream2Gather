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
