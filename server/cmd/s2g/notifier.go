package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.temporal.io/sdk/client"
	temporalworker "go.temporal.io/sdk/worker"

	"stream2gather/internal/config"
	"stream2gather/internal/notify"
	"stream2gather/internal/notify/webpush"
	"stream2gather/internal/store"
	"stream2gather/internal/workflows"
)

// notifier delivers web push. It alone holds the VAPID private key.
func notifier(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	sender, err := webpush.New(cfg.VAPID.PublicKey, cfg.VAPID.PrivateKey, cfg.VAPID.Subject)
	if err != nil {
		return err
	}
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	db := store.NewPostgres(pool)

	health := &http.Server{Addr: cfg.NotifierHealthAddr, Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := health.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("notifier health stopped", "error", err)
		}
	}()
	defer health.Close()

	activities := &notify.Activities{Store: db, Channel: &notify.Push{Devices: db, Sender: sender, Log: log}}
	return workflows.Serve(ctx, cfg.TemporalAddr, cfg.TemporalNamespace, notify.Queue, log, func(ctx context.Context, c client.Client, w temporalworker.Worker) error {
		w.RegisterWorkflow(notify.NotifySession)
		w.RegisterWorkflow(notify.NotifyRecap)
		w.RegisterActivity(activities)
		go (&notify.Pump{Outbox: db, Start: notify.TemporalStarter(c), Log: log}).Run(ctx)
		return nil
	})
}

// vapidKeys prints a new key pair as env lines, for the Makefile to append to
// .env.local. Nothing else should print these.
func vapidKeys() error {
	public, private, err := webpush.GenerateKeys()
	if err != nil {
		return err
	}
	fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\nVAPID_SUBJECT=mailto:push@stream2gather.test\n", public, private)
	return nil
}
