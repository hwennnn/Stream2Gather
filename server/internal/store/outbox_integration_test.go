package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"stream2gather/internal/ids"
)

func TestStaleOutboxRowsCloseUnsent(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	insert := func(kind, age string) string {
		ref := ids.New()
		if _, err := db.pool.Exec(ctx, `INSERT INTO outbox (kind, ref, created_at) VALUES ($1, $2, now() - $3::interval)`, kind, ref, age); err != nil {
			t.Fatal(err)
		}
		return ref
	}
	cases := []struct {
		ref  string
		open bool
	}{
		{insert("session.started", "6 minutes"), false},
		{insert("session.started", "4 minutes"), true},
		{insert("recap.ready", "6 minutes"), true},
		{insert("recap.ready", "25 hours"), false},
	}
	if _, err := db.ExpireOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if open := count(t, db, `SELECT count(*) FROM outbox WHERE ref = $1 AND done_at IS NULL`, c.ref) == 1; open != c.open {
			t.Errorf("%s: open = %v", c.ref, open)
		}
	}
}

func TestListenWakesOnANotifyWithoutWaitingForThePoll(t *testing.T) {
	db := testPostgres(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	woken := make(chan struct{}, 8)
	failed := make(chan error, 1)
	go func() { failed <- db.ListenOutbox(ctx, time.Hour, func(context.Context) { woken <- struct{}{} }) }()
	<-woken
	if _, err := db.pool.Exec(ctx, `SELECT pg_notify('outbox', '')`); err != nil {
		t.Fatal(err)
	}
	select {
	case <-woken:
	case <-time.After(5 * time.Second):
		t.Fatal("no wake from NOTIFY")
	}
	cancel()
	if err := <-failed; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
