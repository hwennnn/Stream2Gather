package store

import (
	"context"
	"strings"
	"testing"
	"time"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
)

// endedSession runs a session of the given people and ends it.
// aGuest makes the row a real guest has, because capture drops anyone without one.
func aGuest(t *testing.T, db *Postgres, name string) string {
	t.Helper()
	id := "u_" + ids.New()
	if err := db.EnsureUser(context.Background(), id, name); err != nil {
		t.Fatal(err)
	}
	return id
}

func endedSession(t *testing.T, db *Postgres, crewID string, moments []CapturedMoment, people ...Person) string {
	t.Helper()
	ctx, start := context.Background(), time.Now().Add(-2*time.Hour)
	err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: start, Playing: true, Source: "youtube", SourceID: "a", Present: people, Moments: moments})
	if err != nil {
		t.Fatal(err)
	}
	var sessionID string
	err = db.pool.QueryRow(ctx, `SELECT id FROM crew_sessions WHERE crew_id = $1 AND ended_at IS NULL`, crewID).Scan(&sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.EndSession(ctx, sessionID, time.Now()); err != nil {
		t.Fatal(err)
	}
	return sessionID
}

func TestBuildingARecapTwiceTellsPeopleOnce(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	sessionID := endedSession(t, db, crewID, nil, Person{UserID: owner, Name: "Hana", Member: true}, Person{UserID: aGuest(t, db, "Mika"), Name: "Mika"})

	for range 2 {
		if err := db.BuildRecap(ctx, sessionID); err != nil {
			t.Fatal(err)
		}
	}

	if got := count(t, db, `SELECT count(*) FROM session_recaps WHERE session_id = $1`, sessionID); got != 1 {
		t.Fatalf("%d recaps", got)
	}
	if got := count(t, db, `SELECT count(*) FROM outbox WHERE kind = 'recap.ready' AND ref = $1`, sessionID); got != 1 {
		t.Fatalf("%d notifications", got)
	}
	unbuilt, err := db.UnbuiltSessions(ctx, 1000)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range unbuilt {
		if id == sessionID {
			t.Fatal("a built session must not come back")
		}
	}
}

func TestSomeoneWatchingAloneGetsARecapAndNoNotification(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	sessionID := endedSession(t, db, crewID, nil, Person{UserID: owner, Name: "Hana", Member: true})

	if err := db.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}

	if got := count(t, db, `SELECT count(*) FROM session_recaps WHERE session_id = $1`, sessionID); got != 1 {
		t.Fatalf("%d recaps", got)
	}
	if got := count(t, db, `SELECT count(*) FROM outbox WHERE kind = 'recap.ready' AND ref = $1`, sessionID); got != 0 {
		t.Fatalf("%d notifications", got)
	}
}

func TestARecapHoldsNothingTheSourceToldUs(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	markers := room.Media{
		Source: "youtube", SourceID: "a", URL: "https://marker.test/url",
		Title: "MARKER-TITLE", Author: "MARKER-AUTHOR", ThumbnailURL: "https://marker.test/thumb", DurationMS: 7654321,
	}
	if err := db.PutMedia(ctx, []room.Media{markers}); err != nil {
		t.Fatal(err)
	}
	hana := Person{UserID: owner, Name: "Hana", Member: true}
	moment := CapturedMoment{Kind: "reaction", UserID: owner, Author: "Hana", Emoji: "🔥", Source: "youtube", SourceID: "a", PosMs: 1000, At: time.Now()}
	sessionID := endedSession(t, db, crewID, []CapturedMoment{moment}, hana)

	if err := db.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}

	var doc string
	if err := db.pool.QueryRow(ctx, `SELECT doc::text FROM session_recaps WHERE session_id = $1`, sessionID).Scan(&doc); err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{"MARKER", "marker.test", "7654321", "title", "thumbnail", "duration"} {
		if strings.Contains(doc, marker) {
			t.Fatalf("%q reached the recap: %s", marker, doc)
		}
	}
}

// The spec's exit: 4 people, 2 hours, under a second. 57,600 is every one of them
// reacting twice a second for the whole session, the most the rate limit allows.
func TestAFourPersonTwoHourSessionBuildsInUnderASecond(t *testing.T) {
	if testing.Short() {
		t.Skip("seeds 57,600 rows")
	}
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	people := []Person{{UserID: owner, Name: "Hana", Member: true}}
	for _, name := range []string{"Mika", "Jo", "Sam"} {
		people = append(people, Person{UserID: aGuest(t, db, name), Name: name})
	}
	sessionID := endedSession(t, db, crewID, nil, people...)
	_, err := db.pool.Exec(ctx, `
		INSERT INTO moments (crew_id, session_id, source, source_id, pos_ms, kind, user_id, author_name, emoji)
		SELECT $1, $2, 'youtube', 'a', n * 125, 'reaction', ($3::text[])[(n % 4) + 1], 'x', '🔥'
		FROM generate_series(0, 57599) AS n`, crewID, sessionID,
		[]string{people[0].UserID, people[1].UserID, people[2].UserID, people[3].UserID})
	if err != nil {
		t.Fatal(err)
	}

	started := time.Now()
	if err := db.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}
	took := time.Since(started)

	t.Logf("built from 57,600 moments in %s", took)
	if took >= time.Second {
		t.Fatalf("took %s", took)
	}
}
