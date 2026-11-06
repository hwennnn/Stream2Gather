package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// MaxOwnedCrews is how many crews one person can own.
const MaxOwnedCrews = 10

// ErrCrewLimit means this person owns all the crews they can.
var ErrCrewLimit = errors.New("too many crews")

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
