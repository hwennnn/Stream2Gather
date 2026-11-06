package store

import (
	"context"
	"slices"
	"testing"
	"time"

	"stream2gather/internal/ids"
)

// aSession opens a session on a new crew with Hana starting it and Bo and Cy, who
// each have a device, away.
func aSession(t *testing.T, db *Postgres) (sessionID string, notice SessionNotice, bo, cy string) {
	t.Helper()
	ctx := context.Background()
	crewID, hana := testCrew(t, db)
	members := []string{"u_" + ids.New(), "u_" + ids.New()}
	for _, member := range members {
		if err := db.EnsureUser(ctx, member, "Friend"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.pool.Exec(ctx, `INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)`, crewID, member); err != nil {
			t.Fatal(err)
		}
	}
	for _, member := range append(members, hana) {
		if _, err := db.SavePushSubscription(ctx, member, testEndpoint(), "p256dh", "auth", ""); err != nil {
			t.Fatal(err)
		}
	}
	person := Person{UserID: hana, Name: "Hana", Member: true}
	capture := Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "youtube", SourceID: "a", Present: []Person{person}, Joined: []Person{person}, PressedPlay: hana}
	if err := db.RecordCapture(ctx, capture); err != nil {
		t.Fatal(err)
	}
	if err := db.pool.QueryRow(ctx, `SELECT id FROM crew_sessions WHERE crew_id = $1`, crewID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	notice, err := db.SessionNotice(ctx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	return sessionID, notice, members[0], members[1]
}

func audience(t *testing.T, db *Postgres, sessionID string, notice SessionNotice) []string {
	t.Helper()
	people, err := db.SessionAudience(context.Background(), sessionID, notice)
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(people)
	return people
}

func TestASessionPingsMembersWhoAreAwayAndWantIt(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	sessionID, notice, bo, cy := aSession(t, db)
	if notice.Starter != "Hana" || !notice.Open || notice.CrewName != "Crew" {
		t.Fatalf("notice %+v", notice)
	}
	want := []string{bo, cy}
	slices.Sort(want)
	if got := audience(t, db, sessionID, notice); !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v: the starter or someone else slipped in", got, want)
	}

	// Stepped out of the session they started: still not someone to tell about it.
	if _, err := db.pool.Exec(ctx, `UPDATE session_people SET left_at = now() WHERE session_id = $1`, sessionID); err != nil {
		t.Fatal(err)
	}
	if got := audience(t, db, sessionID, notice); !slices.Equal(got, want) {
		t.Fatalf("the starter is pinged about their own session: %v", got)
	}

	// Here already.
	if _, err := db.pool.Exec(ctx, `
		INSERT INTO session_people (session_id, user_id, display_name, is_guest, joined_at) VALUES ($1, $2, 'Bo', false, now())`, sessionID, bo); err != nil {
		t.Fatal(err)
	}
	if got := audience(t, db, sessionID, notice); !slices.Equal(got, []string{cy}) {
		t.Fatalf("someone present is pinged: %v", got)
	}
	// Left again, so they can be told.
	if _, err := db.pool.Exec(ctx, `UPDATE session_people SET left_at = now() WHERE session_id = $1 AND user_id = $2`, sessionID, bo); err != nil {
		t.Fatal(err)
	}
	if got := audience(t, db, sessionID, notice); len(got) != 2 {
		t.Fatalf("someone who left is skipped: %v", got)
	}
	// Turned it off.
	if err := db.SetCrewNotify(ctx, notice.CrewID, bo, "off"); err != nil {
		t.Fatal(err)
	}
	if got := audience(t, db, sessionID, notice); !slices.Equal(got, []string{cy}) {
		t.Fatalf("notify=off is pinged: %v", got)
	}
	// No device left.
	if _, err := db.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id = $1`, cy); err != nil {
		t.Fatal(err)
	}
	if got := audience(t, db, sessionID, notice); len(got) != 0 {
		t.Fatalf("someone with no device is listed: %v", got)
	}
}

func TestThePingCapHoldsForThirtyMinutes(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	sessionID, notice, bo, cy := aSession(t, db)
	if claimed, err := db.ClaimNotification(ctx, bo, notice.CrewID, "session.started", "earlier"); err != nil || !claimed {
		t.Fatalf("claimed = %v, err = %v", claimed, err)
	}
	if got := audience(t, db, sessionID, notice); !slices.Equal(got, []string{cy}) {
		t.Fatalf("pinged again inside the cap: %v", got)
	}
	if _, err := db.pool.Exec(ctx, `UPDATE notification_log SET sent_at = now() - interval '31 minutes' WHERE user_id = $1`, bo); err != nil {
		t.Fatal(err)
	}
	if got := audience(t, db, sessionID, notice); len(got) != 2 {
		t.Fatalf("still held after the cap: %v", got)
	}
}

func TestAClaimIsOneSend(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	sessionID, notice, bo, _ := aSession(t, db)
	claim := func() bool {
		claimed, err := db.ClaimNotification(ctx, bo, notice.CrewID, "session.started", sessionID)
		if err != nil {
			t.Fatal(err)
		}
		return claimed
	}
	if !claim() || claim() {
		t.Fatal("a claim should win once")
	}
	if err := db.ReleaseNotification(ctx, bo, "session.started", sessionID); err != nil {
		t.Fatal(err)
	}
	if !claim() {
		t.Fatal("a released claim stayed taken")
	}
}

func TestARecapGoesToMembersWhoCameWithSomeone(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	sessionID, notice, bo, cy := aSession(t, db)
	if got, err := db.RecapAudience(ctx, sessionID, notice); err != nil || len(got) != 0 {
		t.Fatalf("a solo session pings: %v, %v", got, err)
	}
	if _, err := db.pool.Exec(ctx, `
		INSERT INTO session_people (session_id, user_id, display_name, is_guest, joined_at, left_at) VALUES ($1, $2, 'Bo', false, now(), now())`, sessionID, bo); err != nil {
		t.Fatal(err)
	}
	got, err := db.RecapAudience(ctx, sessionID, notice)
	if err != nil || len(got) != 2 || slices.Contains(got, cy) {
		t.Fatalf("recap audience %v, err = %v", got, err)
	}
}
