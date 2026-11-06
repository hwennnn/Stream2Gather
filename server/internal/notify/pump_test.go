package notify

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"go.temporal.io/api/enums/v1"

	"stream2gather/internal/store"
)

type fakeOutbox struct {
	rows       []store.OutboxRow
	failFinish bool
}

func (f *fakeOutbox) ExpireOutbox(context.Context) (int64, error) { return 0, nil }

func (f *fakeOutbox) WaitingOutbox(context.Context) ([]store.OutboxRow, error) {
	return f.rows, nil
}

func (f *fakeOutbox) FinishOutbox(_ context.Context, id int64) error {
	if f.failFinish {
		return errors.New("crashed before marking it done")
	}
	for i, row := range f.rows {
		if row.ID == id {
			f.rows = append(f.rows[:i:i], f.rows[i+1:]...)
			break
		}
	}
	return nil
}

func (f *fakeOutbox) ListenOutbox(context.Context, time.Duration, func(context.Context)) error {
	return nil
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestACrashBetweenStartAndMarkDoneStartsTheSameIDAgain(t *testing.T) {
	outbox := &fakeOutbox{rows: []store.OutboxRow{{ID: 1, Kind: KindStarted, Ref: "s1"}}, failFinish: true}
	var ids []string
	pump := &Pump{Outbox: outbox, Log: quiet(), Start: func(_ context.Context, row store.OutboxRow) error {
		ids = append(ids, startOptions(row).ID)
		return nil
	}}
	pump.drain(context.Background())
	outbox.failFinish = false
	pump.drain(context.Background())
	if len(ids) != 2 || ids[0] != ids[1] || ids[0] != "notify-session.started-s1" {
		t.Fatalf("started %v", ids)
	}
	if len(outbox.rows) != 0 {
		t.Fatalf("still waiting: %v", outbox.rows)
	}
}

func TestASecondStartIsRefusedEvenAfterTheFirstFinished(t *testing.T) {
	options := startOptions(store.OutboxRow{Kind: KindRecap, Ref: "s1"})
	if options.WorkflowIDReusePolicy != enums.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE || !options.WorkflowExecutionErrorWhenAlreadyStarted {
		t.Fatalf("options %+v", options)
	}
}

func TestTemporalBeingDownLeavesTheRowWaiting(t *testing.T) {
	outbox := &fakeOutbox{rows: []store.OutboxRow{{ID: 1, Kind: KindStarted, Ref: "s1"}, {ID: 2, Kind: KindStarted, Ref: "s2"}}}
	attempts := 0
	pump := &Pump{Outbox: outbox, Log: quiet(), Start: func(context.Context, store.OutboxRow) error {
		attempts++
		return errors.New("temporal is down")
	}}
	pump.drain(context.Background())
	if attempts != 1 || len(outbox.rows) != 2 {
		t.Fatalf("attempts %d, rows %v", attempts, outbox.rows)
	}
}

func TestAnUnknownKindIsAnError(t *testing.T) {
	if _, err := workflowFor("nonsense"); err == nil {
		t.Fatal("accepted")
	}
}
