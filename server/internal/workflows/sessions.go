package workflows

import (
	"context"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// SessionStore is what session sweeping needs from Postgres. It grows with the
// sweeper, and main.go already passes the store. Track A owns this file.
type SessionStore interface{}

// registerSessions adds session workflows and schedules to the maintenance
// worker. Methods on Activities are registered already.
func registerSessions(context.Context, client.Client, worker.Worker) error { return nil }
