// Command s2g runs Stream2Gather.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/redis/go-redis/v9"

	"stream2gather/internal/api"
	"stream2gather/internal/auth"
	"stream2gather/internal/config"
	"stream2gather/internal/hub"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
	"stream2gather/internal/telemetry"
	"stream2gather/internal/workflows"
	"stream2gather/migrations"
)

// A closing socket waits up to five seconds for a dead peer's reply.
const shutdownTimeout = 10 * time.Second

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: s2g serve | worker | notifier | migrate")
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err == nil {
		switch os.Args[1] {
		case "serve":
			err = serve(ctx, cfg, log)
		case "migrate":
			err = migrate(cfg)
		case "worker":
			err = worker(ctx, cfg, log)
		case "notifier":
			err = notifier(ctx, cfg, log)
		default:
			err = fmt.Errorf("unknown command %q", os.Args[1])
		}
	}
	if err != nil {
		log.Error("stopped", "error", err)
		os.Exit(1)
	}
}

func migrate(cfg config.Config) error {
	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.Up(db, ".")
}

func catalogFor(cfg config.Config, db *store.Postgres, log *slog.Logger) *source.Catalog {
	sources := []source.Source{source.NewYouTube(cfg.YouTubeAPIKey, cfg.YouTubeBaseURL)}
	if cfg.AllowDirectMedia {
		sources = append(sources, source.Direct{HTTPSOnly: cfg.Env != "dev"})
	}
	catalog := source.NewCatalog(db, cfg.SearchDailyBudget, log, sources...)
	catalog.LookupBudget = cfg.LookupDailyBudget
	return catalog
}

// worker runs background jobs. Temporal is deliberately not on the playback path.
func worker(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	sink, err := telemetry.NewSink(cfg.ClickHouseHTTP, log)
	if err != nil {
		return err
	}
	go sink.Run(ctx)
	db := store.NewPostgres(pool)
	return workflows.Run(ctx, cfg.TemporalAddr, cfg.TemporalNamespace, log, &workflows.Activities{
		Rooms:    db,
		Media:    catalogFor(cfg, db, log),
		Sessions: db,
		Metrics:  sink,
	})
}

func serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	if err := migrate(cfg); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	defer rdb.Close()

	issuer, err := auth.NewIssuer(cfg.SessionKey)
	if err != nil {
		return err
	}
	sink, err := telemetry.NewSink(cfg.ClickHouseHTTP, log)
	if err != nil {
		return err
	}
	go sink.Run(ctx)

	db := store.NewPostgres(pool)
	live := store.NewLive(rdb)

	catalog := catalogFor(cfg, db, log)

	rooms := hub.New(db, live, rdb, catalog, log)
	go rooms.Run(ctx)

	server := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: (&api.Server{
			DB: db, Live: live, Pool: pool, Redis: rdb, Hub: rooms, Catalog: catalog,
			Issuer: issuer, Sink: sink, Log: log,
			PublicOrigin: cfg.PublicOrigin, WebDir: cfg.WebDir, Secure: cfg.Env != "dev",
			DirectMedia: cfg.AllowDirectMedia, TrustedProxy: cfg.TrustedProxy,
			Clerk: clerkVerifier(cfg), ClerkPublishableKey: cfg.ClerkPublishable,
			Voice: cfg.LiveKit, VAPIDPublicKey: cfg.VAPID.PublicKey,
			Vimeo: cfg.EnableVimeo, Twitch: cfg.EnableTwitch, TwitchParent: cfg.TwitchParent,
		}).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		// Sockets are hijacked, so Shutdown only stops the listener for them.
		// Rooms need both Redis and Postgres, which close when serve returns.
		go func() { _ = server.Shutdown(shutdown) }()
		if err := rooms.Close(shutdown); err != nil {
			log.Warn("rooms did not close in time", "error", err)
		}
	}()

	log.Info("listening", "addr", cfg.HTTPAddr)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-stopped
	return nil
}

// clerkVerifier returns nil, not a typed nil, so guests keep working without keys.
func clerkVerifier(cfg config.Config) api.ClerkVerifier {
	if cfg.ClerkSecret == "" || cfg.ClerkPublishable == "" {
		return nil
	}
	return auth.NewClerk(cfg.ClerkSecret, cfg.PublicOrigin)
}
