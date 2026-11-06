package notify

import (
	"context"
	"slices"
	"testing"
	"time"

	"go.temporal.io/sdk/testsuite"

	"stream2gather/internal/ids"
)

func (s scene) run(t *testing.T, channel *fakeChannel, workflow any, during func(*testsuite.TestWorkflowEnvironment)) {
	t.Helper()
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterActivity(&Activities{Store: s.db, Channel: channel})
	if during != nil {
		during(env)
	}
	env.ExecuteWorkflow(workflow, s.sessionID)
	if !env.IsWorkflowCompleted() {
		t.Fatal("the workflow never finished")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
}

func sorted(values ...string) []string {
	slices.Sort(values)
	return values
}

func TestNotifySessionWaitsThenPingsOnlyWhoIsAway(t *testing.T) {
	s := aCrew(t)
	s.seat(t, s.cy)
	channel := &fakeChannel{}
	s.run(t, channel, NotifySession, func(env *testsuite.TestWorkflowEnvironment) {
		env.RegisterDelayedCallback(func() {
			channel.mu.Lock()
			defer channel.mu.Unlock()
			if channel.calls != 0 {
				t.Error("pinged inside the timer")
			}
		}, minSettle-time.Second)
	})
	if !slices.Equal(channel.reached, []string{s.bo}) {
		t.Fatalf("reached %v, want only Bo: starter and present are skipped", channel.reached)
	}
	if channel.titles[0] != "Hana started watching in Movie Night" {
		t.Fatalf("title %q", channel.titles[0])
	}
}

func TestASessionThatEndsInsideTheTimerPingsNobody(t *testing.T) {
	s := aCrew(t)
	channel := &fakeChannel{}
	s.run(t, channel, NotifySession, func(env *testsuite.TestWorkflowEnvironment) {
		env.RegisterDelayedCallback(func() {
			s.exec(t, `UPDATE crew_sessions SET ended_at = now() WHERE id = $1`, s.sessionID)
		}, 10*time.Second)
	})
	if channel.calls != 0 {
		t.Fatalf("reached %v", channel.reached)
	}
}

func TestTheCapStopsASecondPingForTheSameCrew(t *testing.T) {
	s := aCrew(t)
	if _, err := s.db.ClaimNotification(context.Background(), s.bo, s.crewID, KindStarted, "earlier-session"); err != nil {
		t.Fatal(err)
	}
	channel := &fakeChannel{}
	s.run(t, channel, NotifySession, nil)
	if !slices.Equal(channel.reached, []string{s.cy}) {
		t.Fatalf("reached %v, want only Cy", channel.reached)
	}
}

func TestABusyServiceIsRetriedAndStillSendsOnce(t *testing.T) {
	s := aCrew(t)
	s.seat(t, s.cy)
	channel := &fakeChannel{busy: 2}
	s.run(t, channel, NotifySession, nil)
	if channel.calls != 3 || !slices.Equal(channel.reached, []string{s.bo}) {
		t.Fatalf("calls %d, reached %v", channel.calls, channel.reached)
	}
}

func TestARecapGoesToWhoCameEvenAfterTheSessionEnded(t *testing.T) {
	s := aCrew(t)
	s.seat(t, s.bo)
	s.exec(t, `UPDATE crew_sessions SET ended_at = now() WHERE id = $1`, s.sessionID)
	channel := &fakeChannel{}
	s.run(t, channel, NotifyRecap, nil)
	if got := sorted(channel.reached...); !slices.Equal(got, sorted(s.hana, s.bo)) {
		t.Fatalf("reached %v", got)
	}
	if channel.titles[0] != "Your recap from Movie Night is ready" {
		t.Fatalf("title %q", channel.titles[0])
	}
}

func TestSettleStaysInsideTheSpecAndIsStable(t *testing.T) {
	for range 200 {
		id := ids.New()
		wait := settle(id)
		if wait < 30*time.Second || wait > 45*time.Second || wait != settle(id) {
			t.Fatalf("settle(%s) = %s", id, wait)
		}
	}
}
