package workflows

import (
	"context"
	"errors"
	"testing"

	"go.temporal.io/sdk/testsuite"
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
	err                error
}

func (f *fakeMedia) RefreshStale(context.Context, int) (int, int, error) {
	return f.refreshed, f.deleted, f.err
}

func run(t *testing.T, activities *Activities) (Summary, error) {
	t.Helper()
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

func TestYouTubeOutageDoesNotStopRoomExpiry(t *testing.T) {
	rooms := &fakeRooms{closed: 1}
	_, err := run(t, &Activities{Rooms: rooms, Media: &fakeMedia{err: errors.New("youtube down")}})
	if err == nil {
		t.Fatal("expected the failed refresh to surface")
	}
	if rooms.calls != 1 {
		t.Fatalf("rooms closed %d times", rooms.calls)
	}
}
