package notify

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"stream2gather/internal/ids"
	"stream2gather/internal/notify/webpush"
	"stream2gather/internal/store"
	"stream2gather/internal/testenv"
)

// fakeChannel records who was reached, and can answer busy a few times first.
type fakeChannel struct {
	mu      sync.Mutex
	busy    int
	calls   int
	reached []string
	titles  []string
}

func (f *fakeChannel) Reach(_ context.Context, userID, _ string, message webpush.Message) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.busy > 0 {
		f.busy--
		return false, &webpush.RetryError{Status: 429, After: time.Second}
	}
	f.reached = append(f.reached, userID)
	f.titles = append(f.titles, message.Title)
	return true, nil
}

type scene struct {
	db                *store.Postgres
	pool              *pgxpool.Pool
	crewID, sessionID string
	hana, bo, cy      string
}

// aCrew has Hana watching, with Bo and Cy away. All three have a device.
func aCrew(t *testing.T) scene {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testenv.PostgresURL())
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(pool.Close)
	if pool.Ping(ctx) != nil {
		t.Skip("postgres not running")
	}
	s := scene{db: store.NewPostgres(pool), pool: pool, crewID: ids.New(), sessionID: ids.New(), hana: "u_" + ids.New(), bo: "u_" + ids.New(), cy: "u_" + ids.New()}
	names := map[string]string{s.hana: "Hana", s.bo: "Bo", s.cy: "Cy"}
	for id, name := range names {
		if err := s.db.EnsureUser(ctx, id, name); err != nil {
			t.Fatal(err)
		}
	}
	roomID := ids.New()
	if err := s.db.CreateCrew(ctx, store.Room{ID: roomID, Slug: roomID, Name: "Movie Night", OwnerID: s.hana}, store.Crew{ID: s.crewID, InviteToken: ids.New()}); err != nil {
		t.Fatal(err)
	}
	for id := range names {
		if id != s.hana {
			s.exec(t, `INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)`, s.crewID, id)
		}
		if _, err := s.db.SavePushSubscription(ctx, id, "https://fcm.googleapis.com/fcm/send/"+ids.New(), "p256dh", "auth", ""); err != nil {
			t.Fatal(err)
		}
	}
	s.exec(t, `INSERT INTO crew_sessions (id, crew_id, started_by) VALUES ($1, $2, $3)`, s.sessionID, s.crewID, s.hana)
	s.seat(t, s.hana)
	return s
}

func (s scene) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}

func (s scene) seat(t *testing.T, userID string) {
	t.Helper()
	s.exec(t, `INSERT INTO session_people (session_id, user_id, display_name, is_guest, joined_at) VALUES ($1, $2, 'x', false, now())`, s.sessionID, userID)
}

func TestDeliveringTwiceSendsOnce(t *testing.T) {
	s := aCrew(t)
	channel := &fakeChannel{}
	activities := &Activities{Store: s.db, Channel: channel}
	delivery := Delivery{UserID: s.bo, CrewID: s.crewID, Kind: KindStarted, Ref: s.sessionID}
	for range 2 {
		if err := activities.Deliver(context.Background(), delivery); err != nil {
			t.Fatal(err)
		}
	}
	if channel.calls != 1 {
		t.Fatalf("sent %d times", channel.calls)
	}
}

type silent struct{ err error }

func (s silent) Reach(context.Context, string, string, webpush.Message) (bool, error) {
	return false, s.err
}

func TestAPingThatReachedNobodyDoesNotSpendTheCap(t *testing.T) {
	s := aCrew(t)
	activities := &Activities{Store: s.db, Channel: silent{}}
	delivery := Delivery{UserID: s.bo, CrewID: s.crewID, Kind: KindStarted, Ref: s.sessionID}
	if err := activities.Deliver(context.Background(), delivery); err != nil {
		t.Fatal(err)
	}
	activities.Channel = silent{errors.New("database went away")}
	if err := activities.Deliver(context.Background(), delivery); err == nil {
		t.Fatal("a failure was swallowed")
	}
	var logged int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM notification_log WHERE user_id = $1`, s.bo).Scan(&logged); err != nil || logged != 0 {
		t.Fatalf("logged %d, err = %v", logged, err)
	}
}

func TestPlansSayWhatTheSpecSays(t *testing.T) {
	s := aCrew(t)
	activities := &Activities{Store: s.db}
	plan, err := activities.PlanSession(context.Background(), s.sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Message.Title != "Hana started watching in Movie Night" || plan.Message.Body != "Join in" || len(plan.Audience) != 2 {
		t.Fatalf("plan %+v", plan)
	}
	s.exec(t, `UPDATE crew_sessions SET started_by = NULL WHERE id = $1`, s.sessionID)
	plan, err = activities.PlanSession(context.Background(), s.sessionID)
	if err != nil || plan.Message.Title != "Someone started watching in Movie Night" {
		t.Fatalf("a guest's session: %+v, %v", plan, err)
	}
	s.exec(t, `UPDATE crew_sessions SET ended_at = now() WHERE id = $1`, s.sessionID)
	if plan, err := activities.PlanSession(context.Background(), s.sessionID); err != nil || len(plan.Audience) != 0 {
		t.Fatalf("an ended session: %+v, %v", plan, err)
	}
	if plan, err := activities.PlanSession(context.Background(), "gone"); err != nil || len(plan.Audience) != 0 {
		t.Fatalf("a deleted session: %+v, %v", plan, err)
	}
}
