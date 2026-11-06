package workflows

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.temporal.io/sdk/testsuite"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
	"stream2gather/internal/telemetry"
)

type fakeRooms struct {
	closed int64
	calls  int
}

func (f *fakeRooms) CloseExpiredRooms(context.Context) (int64, error) {
	f.calls++
	return f.closed, nil
}

type fakeMedia struct {
	refreshed, deleted int
	backlog, purged    int64
	err                error
}

func (f *fakeMedia) RefreshStale(context.Context, int) (int, int, error) {
	return f.refreshed, f.deleted, f.err
}

func (f *fakeMedia) StaleBacklog(context.Context) (int64, error) { return f.backlog, nil }

func (f *fakeMedia) PurgeSearches(context.Context) (int64, error) { return f.purged, nil }

type fakeMetrics struct{ events []telemetry.Event }

func (f *fakeMetrics) Add(event telemetry.Event) { f.events = append(f.events, event) }

type fakeSessions struct {
	due     []store.SavedRoom
	fresh   []room.Media
	written map[string]room.State
	open    []store.OpenSession
	ended   map[string]time.Time
	touched []string

	cohort, returned int64
}

func (f *fakeSessions) SecondSessions(context.Context) (int64, int64, error) {
	return f.cohort, f.returned, nil
}

func (f *fakeSessions) OpenSessions(context.Context) ([]store.OpenSession, error) { return f.open, nil }

func (f *fakeSessions) TouchSession(_ context.Context, id string, _ time.Time) error {
	f.touched = append(f.touched, id)
	return nil
}

func (f *fakeSessions) EndSession(_ context.Context, id string, at time.Time) (bool, error) {
	f.ended[id] = at
	return true, nil
}

func (f *fakeSessions) DueSnapshots(context.Context, int) ([]store.SavedRoom, error) {
	return f.due, nil
}

func (f *fakeSessions) FreshMedia(context.Context, []room.Item) ([]room.Media, error) {
	return f.fresh, nil
}

func (f *fakeSessions) PutCheckedSnapshot(_ context.Context, id string, state room.State) error {
	f.written[id] = state
	return nil
}

type fakePresence map[string][]store.Person

func (f fakePresence) People(_ context.Context, id string) ([]store.Person, error) { return f[id], nil }

func (f fakePresence) Load(_ context.Context, id string) (room.State, bool, error) {
	state := room.New()
	if id == "playing" {
		state.Playback.Status = room.StatusPlaying
	}
	return state, true, nil
}

func run(t *testing.T, activities *Activities) (Summary, error) {
	t.Helper()
	if activities.Sessions == nil {
		activities.Sessions = &fakeSessions{}
	}
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterActivity(activities)
	env.ExecuteWorkflow(Maintenance)
	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	var summary Summary
	if err := env.GetWorkflowError(); err != nil {
		return summary, err
	}
	return summary, env.GetWorkflowResult(&summary)
}

func TestMaintenanceReportsBothJobs(t *testing.T) {
	summary, err := run(t, &Activities{
		Rooms: &fakeRooms{closed: 3},
		Media: &fakeMedia{refreshed: 40, deleted: 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.RoomsClosed != 3 || summary.Refreshed != 40 || summary.MediaDeleted != 2 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestMaintenanceReportsTheBacklogAndPurgesSearches(t *testing.T) {
	metrics := &fakeMetrics{}
	summary, err := run(t, &Activities{
		Rooms:   &fakeRooms{},
		Media:   &fakeMedia{backlog: 12, purged: 7},
		Metrics: metrics,
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Backlog != 12 || summary.SearchesPurged != 7 {
		t.Fatalf("summary = %+v", summary)
	}
	if len(metrics.events) != 1 || metrics.events[0].Name != "media_stale_backlog" || metrics.events[0].Value != 12 {
		t.Fatalf("metrics = %+v", metrics.events)
	}
}

func TestSnapshotRefreshRewritesEmptyRoomsAndLeavesWatchedOnes(t *testing.T) {
	saved := func(id string) store.SavedRoom {
		state := room.New()
		state.Queue = []room.Item{{ID: "a", Media: room.Media{Source: "youtube", SourceID: "A", Title: "Old"}}}
		return store.SavedRoom{ID: id, State: state}
	}
	sessions := &fakeSessions{
		due:     []store.SavedRoom{saved("empty"), saved("watched")},
		fresh:   []room.Media{{Source: "youtube", SourceID: "A", Title: "New"}},
		written: map[string]room.State{},
	}
	summary, err := run(t, &Activities{
		Rooms: &fakeRooms{}, Media: &fakeMedia{}, Sessions: sessions,
		Presence: fakePresence{"watched": {{UserID: "someone"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Snapshots != 1 || len(sessions.written) != 1 || sessions.written["empty"].Queue[0].Title != "New" {
		t.Fatalf("summary = %+v, written = %+v", summary, sessions.written)
	}
}

func TestYouTubeOutageDoesNotStopTheOtherJobs(t *testing.T) {
	rooms := &fakeRooms{closed: 1}
	_, err := run(t, &Activities{Rooms: rooms, Media: &fakeMedia{purged: 1, err: errors.New("youtube down")}})
	if err == nil {
		t.Fatal("expected the failed refresh to surface")
	}
	if rooms.calls != 1 {
		t.Fatalf("rooms closed %d times", rooms.calls)
	}
}

func TestASessionEndsWhenTheRoomEmptiesOrGoesQuiet(t *testing.T) {
	now := time.Now()
	ago := func(d time.Duration) time.Time { return now.Add(-d) }
	cases := []struct {
		name             string
		session          store.OpenSession
		present, playing bool
		over             bool
		at               time.Time
	}{
		{name: "empty for 4 minutes", session: store.OpenSession{LastActivity: ago(time.Hour), LastLeft: ago(4 * time.Minute)}},
		{name: "empty for 5 minutes", session: store.OpenSession{LastActivity: ago(time.Hour), LastLeft: ago(5 * time.Minute)}, over: true, at: ago(5 * time.Minute)},
		{name: "empty since a crash, nobody ever left", session: store.OpenSession{LastActivity: ago(6 * time.Minute)}, over: true, at: ago(6 * time.Minute)},
		{name: "here and paused for 29 minutes", session: store.OpenSession{LastActivity: ago(29 * time.Minute)}, present: true},
		{name: "here and paused for 30 minutes", session: store.OpenSession{LastActivity: ago(30 * time.Minute)}, present: true, over: true, at: ago(30 * time.Minute)},
		{name: "a film nobody touches", session: store.OpenSession{LastActivity: ago(2 * time.Hour)}, present: true, playing: true},
		{name: "playing to an empty room", session: store.OpenSession{LastActivity: ago(time.Hour), LastLeft: ago(10 * time.Minute)}, playing: true, over: true, at: ago(10 * time.Minute)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			at, over := sessionEnd(c.session, c.present, c.playing, now)
			if over != c.over || (over && !at.Equal(c.at)) {
				t.Fatalf("over %v at %v", over, at)
			}
		})
	}
}

func TestTheSweepEndsWhatIsOverAndKeepsAPlayingFilmAlive(t *testing.T) {
	sessions := &fakeSessions{ended: map[string]time.Time{}, open: []store.OpenSession{
		{ID: "film", RoomID: "playing", LastActivity: time.Now().Add(-2 * time.Hour)},
		{ID: "gone", RoomID: "empty", LastActivity: time.Now().Add(-time.Hour)},
	}}
	activities := &Activities{Sessions: sessions, Presence: fakePresence{"playing": {{UserID: "u"}}}}

	ended, err := activities.SweepSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, gone := sessions.ended["gone"]; !gone || ended != 1 {
		t.Fatalf("ended %v", sessions.ended)
	}
	if len(sessions.touched) != 1 || sessions.touched[0] != "film" {
		t.Fatalf("touched %v", sessions.touched)
	}
}

func TestTheHeadlineMetricIsAShareAndStaysQuietWithNoCohort(t *testing.T) {
	metrics := &fakeMetrics{}
	sessions := &fakeSessions{}
	activities := &Activities{Sessions: sessions, Metrics: metrics}
	if err := activities.MeasureCrews(context.Background()); err != nil || len(metrics.events) != 0 {
		t.Fatalf("no cohort: %v %v", err, metrics.events)
	}

	sessions.cohort, sessions.returned = 4, 1
	if err := activities.MeasureCrews(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(metrics.events) != 1 || metrics.events[0].Name != "crew_second_session_14d" || metrics.events[0].Value != 0.25 {
		t.Fatalf("%+v", metrics.events)
	}
}
