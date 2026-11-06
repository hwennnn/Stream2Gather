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
	if got := count(t, db, `SELECT count(*) FROM session_items WHERE session_id = $1`, sessionID); got != 1 {
		t.Fatalf("%d item rows for one video", got)
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

func TestAChangeOfVideoClosesTheLastAndTicksTheWatchlist(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	if err := db.AddWatch(ctx, crewID, "youtube", "b", owner); err != nil {
		t.Fatal(err)
	}

	for _, video := range []string{"a", "b"} {
		err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "youtube", SourceID: video})
		if err != nil {
			t.Fatal(err)
		}
	}

	if got := count(t, db, `
		SELECT count(*) FROM session_items i JOIN crew_sessions s ON s.id = i.session_id
		WHERE s.crew_id = $1 AND i.ended_at IS NULL AND i.source_id = 'b'`, crewID); got != 1 {
		t.Fatalf("%d open rows for the second video", got)
	}
	if got := count(t, db, `
		SELECT count(*) FROM session_items i JOIN crew_sessions s ON s.id = i.session_id
		WHERE s.crew_id = $1 AND i.ended_at IS NOT NULL AND i.source_id = 'a'`, crewID); got != 1 {
		t.Fatalf("%d closed rows for the first video", got)
	}
	if got := count(t, db, `SELECT count(*) FROM watchlist_items WHERE crew_id = $1 AND watched_session_id IS NOT NULL`, crewID); got != 1 {
		t.Fatalf("%d watched", got)
	}
}

func TestMomentsKeepTheirPlaceAndEndingClosesWhatACrashLeftOpen(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	hana := Person{UserID: owner, Name: "Hana", Member: true}
	at := time.Now()

	err := db.RecordCapture(ctx, Capture{
		CrewID: crewID, At: at, Playing: true, Source: "youtube", SourceID: "a", Present: []Person{hana}, Active: true,
		Moments: []CapturedMoment{{Kind: "reaction", UserID: owner, Author: "Hana", Emoji: "🔥", Source: "youtube", SourceID: "a", PosMs: 61_500, At: at}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := count(t, db, `SELECT count(*) FROM moments WHERE crew_id = $1 AND pos_ms = 61500 AND session_id IS NOT NULL`, crewID); got != 1 {
		t.Fatalf("%d moments", got)
	}

	open, err := db.OpenSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var sessionID string
	for _, session := range open {
		if count(t, db, `SELECT count(*) FROM crew_sessions WHERE id = $1 AND crew_id = $2`, session.ID, crewID) == 1 {
			sessionID = session.ID
		}
	}
	if sessionID == "" {
		t.Fatal("the session isn't listed as open")
	}

	ended := at.Add(time.Minute)
	if done, err := db.EndSession(ctx, sessionID, ended); err != nil || !done {
		t.Fatal(done, err)
	}
	if done, err := db.EndSession(ctx, sessionID, ended); err != nil || done {
		t.Fatalf("second end: %v %v", done, err)
	}
	if got := count(t, db, `SELECT count(*) FROM session_people WHERE session_id = $1 AND left_at IS NULL`, sessionID); got != 0 {
		t.Fatalf("%d people still seated", got)
	}
	if got := count(t, db, `SELECT count(*) FROM session_items WHERE session_id = $1 AND ended_at IS NULL`, sessionID); got != 0 {
		t.Fatalf("%d items still open", got)
	}
}

func TestOnlyCrewsPastTheirFortnightCountTowardsComingBack(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	cohortBefore, returnedBefore, err := db.SecondSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	session := func(crewID string, daysAgo int) {
		t.Helper()
		_, err := db.pool.Exec(ctx, `
			INSERT INTO crew_sessions (id, crew_id, started_at, ended_at)
			VALUES ($1, $2, now() - make_interval(days => $3), now() - make_interval(days => $3))`, ids.New(), crewID, daysAgo)
		if err != nil {
			t.Fatal(err)
		}
	}
	back, gone, late, young := "", "", "", ""
	for _, id := range []*string{&back, &gone, &late, &young} {
		*id, _ = testCrew(t, db)
	}
	session(back, 20)
	session(back, 10)
	session(gone, 20)
	session(late, 40)
	session(late, 1)
	session(young, 3)

	cohort, returned, err := db.SecondSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cohort-cohortBefore != 3 || returned-returnedBefore != 1 {
		t.Fatalf("cohort up %d, returned up %d", cohort-cohortBefore, returned-returnedBefore)
	}
}
