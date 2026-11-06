package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"

	"stream2gather/internal/store"
)

const (
	pollEvery = 30 * time.Second
	// How long to leave a lost database connection before listening again.
	relisten = 5 * time.Second
)

// Outbox is what the pump needs from Postgres.
type Outbox interface {
	ExpireOutbox(ctx context.Context) (int64, error)
	WaitingOutbox(ctx context.Context) ([]store.OutboxRow, error)
	FinishOutbox(ctx context.Context, id int64) error
	ListenOutbox(ctx context.Context, poll time.Duration, wake func(context.Context)) error
}

// Starter begins the workflow for one outbox row. Starting the same row twice
// must be harmless, because a crash can land between starting and marking it done.
type Starter func(ctx context.Context, row store.OutboxRow) error

// Pump moves outbox rows into Temporal.
type Pump struct {
	Outbox Outbox
	Start  Starter
	Log    *slog.Logger
}

// Run pumps until ctx ends.
func (p *Pump) Run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := p.Outbox.ListenOutbox(ctx, pollEvery, p.drain); err != nil {
			p.Log.Warn("outbox listener stopped", "error", err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(relisten):
		}
	}
}

// drain hands over everything waiting, and leaves the rest for the next wake if
// Temporal is down. Rows stay put until a start is known to have worked.
func (p *Pump) drain(ctx context.Context) {
	expired, err := p.Outbox.ExpireOutbox(ctx)
	if err != nil {
		p.Log.Warn("outbox not expired", "error", err)
		return
	}
	if expired > 0 {
		p.Log.Info("outbox rows closed unsent", "count", expired)
	}
	for ctx.Err() == nil {
		rows, err := p.Outbox.WaitingOutbox(ctx)
		if err != nil {
			p.Log.Warn("outbox not read", "error", err)
			return
		}
		if len(rows) == 0 {
			return
		}
		for _, row := range rows {
			if err := p.Start(ctx, row); err != nil {
				p.Log.Warn("workflow not started", "kind", row.Kind, "error", err)
				return
			}
			if err := p.Outbox.FinishOutbox(ctx, row.ID); err != nil {
				p.Log.Warn("outbox row not finished", "error", err)
				return
			}
		}
	}
}

// TemporalStarter starts one workflow per row. The ID is what makes a second start
// harmless: Temporal refuses it, running or finished, and that counts as started.
func TemporalStarter(c client.Client) Starter {
	return func(ctx context.Context, row store.OutboxRow) error {
		workflow, err := workflowFor(row.Kind)
		if err != nil {
			return err
		}
		_, err = c.ExecuteWorkflow(ctx, startOptions(row), workflow, row.Ref)
		var started *serviceerror.WorkflowExecutionAlreadyStarted
		if errors.As(err, &started) {
			return nil
		}
		return err
	}
}

func startOptions(row store.OutboxRow) client.StartWorkflowOptions {
	return client.StartWorkflowOptions{
		ID:                                       "notify-" + row.Kind + "-" + row.Ref,
		TaskQueue:                                Queue,
		WorkflowIDReusePolicy:                    enums.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowExecutionErrorWhenAlreadyStarted: true,
	}
}

func workflowFor(kind string) (any, error) {
	switch kind {
	case KindStarted:
		return NotifySession, nil
	case KindRecap:
		return NotifyRecap, nil
	}
	return nil, fmt.Errorf("unknown outbox kind %q", kind)
}
