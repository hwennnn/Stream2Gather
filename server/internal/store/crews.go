package store

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	// MaxCrewMembers is the roster's size. The room's own cap counts who is here.
	MaxCrewMembers = 50
	// MaxOwnedCrews is how many crews one person can own.
	MaxOwnedCrews = 10
)

// Reasons a crew change is refused.
var (
	ErrCrewLimit     = errors.New("too many crews")
	ErrCrewFull      = errors.New("crew is full")
	ErrInvalidInvite = errors.New("invalid invite")
	ErrRoomClosed    = errors.New("room closed")
)

// Crew is a group's permanent home. Its room holds the name and the owner.
type Crew struct {
	ID          string
	RoomID      string
	Slug        string
	Name        string
	OwnerID     string
	InviteToken string
	GuestAccess bool
}

// CrewAccess is what one person may do in a room with a crew.
type CrewAccess struct {
	Exists      bool
	Member      bool
	GuestAccess bool
	MemberCount int
}

// CrewMember is one name on a roster.
type CrewMember struct {
	UserID    string    `json:"userId"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	JoinedAt  time.Time `json:"joinedAt"`
}

// reserveCrew turns away an owner who has no crews left. The row lock makes two
// requests from one person take turns, so both can't take the last place.
func reserveCrew(ctx context.Context, tx pgx.Tx, ownerID string) error {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, ownerID); err != nil {
		return err
	}
	var owned int
	err := tx.QueryRow(ctx, `
		SELECT count(*) FROM crews c JOIN rooms r ON r.id = c.room_id WHERE r.owner_id = $1`, ownerID,
	).Scan(&owned)
	if err == nil && owned >= MaxOwnedCrews {
		return ErrCrewLimit
	}
	return err
}

func addCrew(ctx context.Context, tx pgx.Tx, crew Crew) error {
	_, err := tx.Exec(ctx, `INSERT INTO crews (id, room_id, invite_token) VALUES ($1, $2, $3)`,
		crew.ID, crew.RoomID, crew.InviteToken)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)`, crew.ID, crew.OwnerID)
	return err
}

// CreateCrew makes a permanent room and its crew together.
func (p *Postgres) CreateCrew(ctx context.Context, r Room, crew Crew) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := reserveCrew(ctx, tx, r.OwnerID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO rooms (id, slug, name, owner_id, is_temporary) VALUES ($1, $2, $3, $4, false)`,
		r.ID, r.Slug, r.Name, r.OwnerID)
	var failure *pgconn.PgError
	if errors.As(err, &failure) && failure.Code == uniqueViolation && failure.ConstraintName == "rooms_slug_key" {
		return ErrSlugTaken
	}
	if err != nil {
		return err
	}
	crew.RoomID, crew.OwnerID = r.ID, r.OwnerID
	if err := addCrew(ctx, tx, crew); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PromoteRoom makes a temporary room permanent and gives it a crew, keeping its
// address. Promoting a room that already has a crew changes nothing.
func (p *Postgres) PromoteRoom(ctx context.Context, r Room, crew Crew) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := reserveCrew(ctx, tx, r.OwnerID); err != nil {
		return err
	}
	// One statement decides this against the room's expiry: the loser gets no row.
	tag, err := tx.Exec(ctx, `
		UPDATE rooms SET is_temporary = false, expires_at = NULL WHERE id = $1 AND closed_at IS NULL`, r.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrRoomClosed
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crews WHERE room_id = $1)`, r.ID).Scan(&exists); err != nil || exists {
		return err
	}
	crew.RoomID, crew.OwnerID = r.ID, r.OwnerID
	if err := addCrew(ctx, tx, crew); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CrewOfRoom returns a room's crew, or ErrNotFound for a room without one.
func (p *Postgres) CrewOfRoom(ctx context.Context, r Room) (Crew, error) {
	crew := Crew{RoomID: r.ID, Slug: r.Slug, Name: r.Name, OwnerID: r.OwnerID}
	err := p.pool.QueryRow(ctx, `
		SELECT id, invite_token, guest_access FROM crews WHERE room_id = $1`, r.ID,
	).Scan(&crew.ID, &crew.InviteToken, &crew.GuestAccess)
	if errors.Is(err, pgx.ErrNoRows) {
		return Crew{}, ErrNotFound
	}
	return crew, err
}

// CrewAccessOf answers in one read, because every ticket asks.
func (p *Postgres) CrewAccessOf(ctx context.Context, roomID, userID string) (CrewAccess, error) {
	var access CrewAccess
	err := p.pool.QueryRow(ctx, `
		SELECT c.guest_access,
		       (SELECT count(*) FROM crew_members m WHERE m.crew_id = c.id),
		       EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = c.id AND m.user_id = $2)
		FROM crews c WHERE c.room_id = $1`, roomID, userID,
	).Scan(&access.GuestAccess, &access.MemberCount, &access.Member)
	if errors.Is(err, pgx.ErrNoRows) {
		return CrewAccess{}, nil
	}
	access.Exists = err == nil
	return access, err
}

// JoinCrew adds someone holding the current invite. The crew's row lock stops two
// joins taking the last place. A member's old link still works: they are in.
func (p *Postgres) JoinCrew(ctx context.Context, crewID, userID, token string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var current string
	err = tx.QueryRow(ctx, `SELECT invite_token FROM crews WHERE id = $1 FOR UPDATE`, crewID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var members int
	var member bool
	err = tx.QueryRow(ctx, `
		SELECT count(*), coalesce(bool_or(user_id = $2), false) FROM crew_members WHERE crew_id = $1`, crewID, userID,
	).Scan(&members, &member)
	if err != nil || member {
		return err
	}
	if subtle.ConstantTimeCompare([]byte(current), []byte(token)) != 1 {
		return ErrInvalidInvite
	}
	if members >= MaxCrewMembers {
		return ErrCrewFull
	}
	if _, err := tx.Exec(ctx, `INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)`, crewID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CrewRoster lists members, longest-standing first.
func (p *Postgres) CrewRoster(ctx context.Context, crewID string) ([]CrewMember, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT m.user_id, u.display_name, coalesce(u.avatar_url, ''), m.joined_at
		FROM crew_members m JOIN users u ON u.id = m.user_id
		WHERE m.crew_id = $1 ORDER BY m.joined_at, m.user_id`, crewID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (CrewMember, error) {
		var m CrewMember
		return m, row.Scan(&m.UserID, &m.Name, &m.AvatarURL, &m.JoinedAt)
	})
}
