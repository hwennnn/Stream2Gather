package store

import (
	"context"
	"sync"
	"testing"
	"time"

	"stream2gather/internal/ids"
)

func testCrew(t *testing.T, db *Postgres) (crewID, ownerID string) {
	t.Helper()
	ctx := context.Background()
	ownerID = "u_" + ids.New()
	if err := db.EnsureUser(ctx, ownerID, "Hana"); err != nil {
		t.Fatal(err)
	}
	roomID := ids.New()
	crewID = ids.New()
	err := db.CreateCrew(ctx, Room{ID: roomID, Slug: roomID, Name: "Crew", OwnerID: ownerID}, Crew{ID: crewID, InviteToken: ids.New()})
	if err != nil {
		t.Fatal(err)
	}
	return crewID, ownerID
}

func count(t *testing.T, db *Postgres, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestOnlyPlayingOpensASessionAndItComesWithOneOutboxRow(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	hana := Person{UserID: owner, Name: "Hana", Member: true}

	if err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: time.Now(), Present: []Person{hana}, Joined: []Person{hana}}); err != nil {
		t.Fatal(err)
	}
	if got := count(t, db, `SELECT count(*) FROM crew_sessions WHERE crew_id = $1`, crewID); got != 0 {
		t.Fatalf("%d sessions before anything played", got)
	}

	play := Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "youtube", SourceID: "a", Present: []Person{hana}}
	for range 2 {
		if err := db.RecordCapture(ctx, play); err != nil {
			t.Fatal(err)
		}
	}

	var sessionID string
	var startedBy *string
	err := db.pool.QueryRow(ctx, `SELECT id, started_by FROM crew_sessions WHERE crew_id = $1`, crewID).Scan(&sessionID, &startedBy)
	if err != nil {
		t.Fatal(err)
	}
	if startedBy == nil || *startedBy != owner {
		t.Fatalf("started by %v", startedBy)
	}
	if got := count(t, db, `SELECT count(*) FROM outbox WHERE kind = 'session.started' AND ref = $1`, sessionID); got != 1 {
		t.Fatalf("%d outbox rows", got)
	}
	if got := count(t, db, `SELECT count(*) FROM session_people WHERE session_id = $1`, sessionID); got != 1 {
		t.Fatalf("%d people seated", got)
	}
}

func TestFirstPlaysOnSeveralServersOpenOneSession(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, _ := testCrew(t, db)

	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "youtube", SourceID: "a"}); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()

	if got := count(t, db, `SELECT count(*) FROM crew_sessions WHERE crew_id = $1 AND ended_at IS NULL`, crewID); got != 1 {
		t.Fatalf("%d open sessions", got)
	}
	if got := count(t, db, `SELECT count(*) FROM outbox o JOIN crew_sessions s ON s.id = o.ref WHERE s.crew_id = $1`, crewID); got != 1 {
		t.Fatalf("%d outbox rows", got)
	}
}
