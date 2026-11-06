package store

import (
	"context"
	"testing"
	"time"
)

// DELETE /v1/me removes a person's moments and leaves "Former member" in the
// sessions they were part of.
func TestDeletingAnAccountTakesItsNameOutOfCapture(t *testing.T) {
	db := testPostgres(t)
	ctx := context.Background()
	crewID, owner := testCrew(t, db)
	leaver := "u_leaver_" + crewID
	if err := db.EnsureUser(ctx, leaver, "Hana Real-Name"); err != nil {
		t.Fatal(err)
	}
	person := Person{UserID: leaver, Name: "Hana Real-Name"}
	at := time.Now()
	err := db.RecordCapture(ctx, Capture{
		CrewID: crewID, At: at, Playing: true, Source: "youtube", SourceID: "a",
		Present: []Person{{UserID: owner, Name: "Owner", Member: true}, person},
		Moments: []CapturedMoment{{Kind: "reaction", UserID: leaver, Author: person.Name, Emoji: "🔥", Source: "youtube", SourceID: "a", At: at}},
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := db.DeleteAccount(ctx, leaver); err != nil {
		t.Fatal(err)
	}

	if n := count(t, db, `SELECT count(*) FROM moments WHERE crew_id = $1 AND author_name <> 'Owner'`, crewID); n != 0 {
		t.Fatalf("%d moments still carry them", n)
	}
	if n := count(t, db, `SELECT count(*) FROM session_people WHERE user_id = $1 AND display_name <> 'Former member'`, leaver); n != 0 {
		t.Fatalf("%d session rows still name them", n)
	}
	if n := count(t, db, `SELECT count(*) FROM session_people WHERE user_id = $1 AND display_name = 'Former member'`, leaver); n != 1 {
		t.Fatalf("%d 'Former member' rows, want the seat kept", n)
	}
}

// A socket outlives its account by up to one session check, and a flush may be
// on its way when the account goes.
func TestCaptureCannotBringADeletedPersonBack(t *testing.T) {
	db := testPostgres(t)
	ctx := context.Background()
	crewID, owner := testCrew(t, db)
	leaver := "u_gone_" + crewID
	if err := db.EnsureUser(ctx, leaver, "Hana Real-Name"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.DeleteAccount(ctx, leaver); err != nil {
		t.Fatal(err)
	}

	at := time.Now()
	gone := Person{UserID: leaver, Name: "Hana Real-Name"}
	err := db.RecordCapture(ctx, Capture{
		CrewID: crewID, At: at, Playing: true, Source: "youtube", SourceID: "a",
		Present: []Person{{UserID: owner, Name: "Owner", Member: true}, gone},
		Joined:  []Person{gone},
		Moments: []CapturedMoment{
			{Kind: "reaction", UserID: leaver, Author: gone.Name, Emoji: "🔥", Source: "youtube", SourceID: "a", At: at},
			{Kind: "reaction", UserID: owner, Author: "Owner", Emoji: "🔥", Source: "youtube", SourceID: "a", At: at},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	if n := count(t, db, `SELECT count(*) FROM session_people WHERE user_id = $1`, leaver); n != 0 {
		t.Fatalf("%d session rows brought them back", n)
	}
	if n := count(t, db, `SELECT count(*) FROM moments WHERE user_id = $1`, leaver); n != 0 {
		t.Fatalf("%d moments brought them back", n)
	}
	if n := count(t, db, `SELECT count(*) FROM moments WHERE user_id = $1`, owner); n != 1 {
		t.Fatalf("%d of the owner's moments, want their own kept", n)
	}
}

// A flush already past its check when the deletion starts: it holds what
// withoutDeleted locks, and writes the person after the deletion has begun.
func TestADeletionWaitsForAFlushAndCleansUpAfterIt(t *testing.T) {
	db := testPostgres(t)
	ctx := context.Background()
	crewID, _ := testCrew(t, db)
	leaver := "u_mid_" + crewID
	if err := db.EnsureUser(ctx, leaver, "Hana Real-Name"); err != nil {
		t.Fatal(err)
	}

	flush, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer flush.Rollback(ctx)
	if _, err := flush.Exec(ctx, `SELECT id FROM users WHERE id = $1 FOR KEY SHARE`, leaver); err != nil {
		t.Fatal(err)
	}
	deleted := make(chan error, 1)
	go func() {
		_, err := db.DeleteAccount(ctx, leaver)
		deleted <- err
	}()
	// Time for a deletion that doesn't wait to clean up first. One that waits blocks here.
	time.Sleep(300 * time.Millisecond)
	_, err = flush.Exec(ctx, `
		INSERT INTO moments (crew_id, source, source_id, pos_ms, kind, user_id, author_name)
		VALUES ($1, 'youtube', 'a', 0, 'reaction', $2, 'Hana Real-Name')`, crewID, leaver)
	if err != nil {
		t.Fatal(err)
	}
	if err := flush.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-deleted; err != nil {
		t.Fatal(err)
	}

	if n := count(t, db, `SELECT count(*) FROM moments WHERE user_id = $1`, leaver); n != 0 {
		t.Fatalf("%d moments outlived the deletion", n)
	}
}

// The sweeper ending a session mid-flush must not leave a video running in it.
func TestAFlushCannotOpenAVideoInASessionBeingEnded(t *testing.T) {
	db := testPostgres(t)
	ctx := context.Background()
	crewID, owner := testCrew(t, db)
	hana := Person{UserID: owner, Name: "Hana", Member: true}
	at := time.Now()
	if err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: at, Playing: true, Present: []Person{hana}}); err != nil {
		t.Fatal(err)
	}
	var sessionID string
	if err := db.pool.QueryRow(ctx, `SELECT id FROM crew_sessions WHERE crew_id = $1`, crewID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}

	// EndSession's transaction, with all its statements run but not yet committed.
	ending, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer ending.Rollback(ctx)
	for _, statement := range []string{
		`UPDATE crew_sessions SET ended_at = $2 WHERE id = $1`,
		`UPDATE session_items SET ended_at = $2 WHERE session_id = $1 AND ended_at IS NULL`,
	} {
		if _, err := ending.Exec(ctx, statement, sessionID, at); err != nil {
			t.Fatal(err)
		}
	}
	flushed := make(chan error, 1)
	go func() {
		flushed <- db.RecordCapture(ctx, Capture{CrewID: crewID, At: at.Add(time.Second), Source: "youtube", SourceID: "late"})
	}()
	// Time for a flush that doesn't wait to finish. One that waits blocks here.
	time.Sleep(300 * time.Millisecond)
	if err := ending.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-flushed; err != nil {
		t.Fatal(err)
	}

	n := count(t, db, `
		SELECT count(*) FROM session_items i JOIN crew_sessions s ON s.id = i.session_id
		WHERE s.crew_id = $1 AND s.ended_at IS NOT NULL AND i.ended_at IS NULL`, crewID)
	if n != 0 {
		t.Fatalf("%d videos left running in a session that ended", n)
	}
}
