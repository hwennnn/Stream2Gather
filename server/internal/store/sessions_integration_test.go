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

	play := Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "youtube", SourceID: "a", Present: []Person{hana}, PressedPlay: owner}
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
	if got := count(t, db, `SELECT count(*) FROM watchlist_items WHERE crew_id = $1 AND watched_session_id IS NOT NULL`, crewID); got != 0 {
		t.Fatalf("%d ticked at first sight", got)
	}
}

func TestAVideoIsTickedByAMemberBeingThereForRealPlay(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	start := time.Now().Add(-time.Hour)
	long := 5 * time.Minute
	for name, tc := range map[string]struct {
		member, guest bool
		// seated and left are how far into the run someone came and went.
		seated, left time.Duration
		want         int
	}{
		"a member for all of it":         {member: true, want: 1},
		"a member who left after enough": {member: true, left: WatchedAfter + time.Second, want: 1},
		"a member who left too soon":     {member: true, left: WatchedAfter - time.Second},
		"a member who came for the end":  {member: true, seated: long - time.Second},
		"a guest alone":                  {guest: true},
	} {
		t.Run(name, func(t *testing.T) {
			crewID, owner := testCrew(t, db)
			if err := db.AddWatch(ctx, crewID, "youtube", "b", owner); err != nil {
				t.Fatal(err)
			}
			person := Person{UserID: owner, Name: "Hana", Member: tc.member}
			at := start.Add(tc.seated)
			if err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: at, Playing: true, Source: "youtube", SourceID: "b", Present: []Person{person}}); err != nil {
				t.Fatal(err)
			}
			end := start.Add(long)
			final := Capture{CrewID: crewID, At: end, Playing: true, Source: "youtube", SourceID: "b",
				Played: []PlayedRun{{Source: "youtube", SourceID: "b", From: start, To: end}}}
			if tc.left > 0 {
				if _, err := db.pool.Exec(ctx, `UPDATE session_people SET left_at = $1`+
					` WHERE session_id = (SELECT id FROM crew_sessions WHERE crew_id = $2)`, start.Add(tc.left), crewID); err != nil {
					t.Fatal(err)
				}
			}
			if err := db.RecordCapture(ctx, final); err != nil {
				t.Fatal(err)
			}
			if got := count(t, db, `SELECT count(*) FROM watchlist_items WHERE crew_id = $1 AND watched_session_id IS NOT NULL`, crewID); got != tc.want {
				t.Fatalf("%d ticked, want %d", got, tc.want)
			}
		})
	}
}

func TestLeavingInTheFlushThatEndsARunStillCounts(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	if err := db.AddWatch(ctx, crewID, "youtube", "b", owner); err != nil {
		t.Fatal(err)
	}
	start := time.Now().Add(-time.Hour)
	end := start.Add(5 * time.Minute)
	hana := Person{UserID: owner, Name: "Hana", Member: true}
	if err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: start, Playing: true, Source: "youtube", SourceID: "b", Present: []Person{hana}}); err != nil {
		t.Fatal(err)
	}
	err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: end, Playing: true, Source: "youtube", SourceID: "b", Left: []string{owner},
		Played: []PlayedRun{{Source: "youtube", SourceID: "b", From: start, To: end}}})
	if err != nil {
		t.Fatal(err)
	}
	if got := count(t, db, `SELECT count(*) FROM watchlist_items WHERE crew_id = $1 AND watched_session_id IS NOT NULL`, crewID); got != 1 {
		t.Fatalf("%d ticked after the last member left at the end", got)
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

func TestASessionNamesWhoPressedPlayOrNobody(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	for name, pick := range map[string]func(member string) (pressed, named string){
		"the newer member, not the longest standing": func(member string) (string, string) { return member, member },
		"nobody, when nobody pressed it":             func(string) (string, string) { return "", "" },
		"nobody, when a guest did":                   func(string) (string, string) { return "g_" + ids.New(), "" },
	} {
		t.Run(name, func(t *testing.T) {
			crewID, owner := testCrew(t, db)
			member := "u_" + ids.New()
			if err := db.EnsureUser(ctx, member, "Bo"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.pool.Exec(ctx, `INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)`, crewID, member); err != nil {
				t.Fatal(err)
			}
			pressed, want := pick(member)
			present := []Person{{UserID: owner, Name: "Hana", Member: true}, {UserID: member, Name: "Bo", Member: true}}
			err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "youtube", SourceID: "a", Present: present, PressedPlay: pressed})
			if err != nil {
				t.Fatal(err)
			}
			var startedBy string
			if err := db.pool.QueryRow(ctx, `SELECT COALESCE(started_by, '') FROM crew_sessions WHERE crew_id = $1`, crewID).Scan(&startedBy); err != nil {
				t.Fatal(err)
			}
			if startedBy != want {
				t.Fatalf("started by %q, want %q", startedBy, want)
			}
		})
	}
}
