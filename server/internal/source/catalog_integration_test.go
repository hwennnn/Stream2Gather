package source

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
	"stream2gather/internal/testenv"
)

type fakeSource struct {
	resolve func() (room.Media, error)
}

func (*fakeSource) Name() string { return "fake" }
func (*fakeSource) Match(link *url.URL) (Ref, bool) {
	return Ref{Source: "fake", ID: link.Path[1:], URL: link.String()}, true
}
func (f *fakeSource) Resolve(context.Context, Ref) (room.Media, error) { return f.resolve() }
func (*fakeSource) Search(context.Context, string, string) ([]room.Media, error) {
	return nil, ErrNoSearch
}
func (*fakeSource) Trending(context.Context) ([]room.Media, error) { return nil, ErrNoSearch }

// These tests need the Postgres from deploy/compose.yaml and skip without it.
func catalogDB(t *testing.T) *store.Postgres {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	pool, err := pgxpool.New(context.Background(), testenv.PostgresURL())
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(pool.Close)
	if pool.Ping(ctx) != nil {
		t.Skip("stack not running")
	}
	return store.NewPostgres(pool)
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestCachedLiveVideoIsAskedAboutAgain(t *testing.T) {
	db := catalogDB(t)
	ctx := context.Background()
	id := ids.New()
	if err := db.PutMedia(ctx, []room.Media{{Source: "fake", SourceID: id, IsLive: true}}); err != nil {
		t.Fatal(err)
	}

	still := &fakeSource{resolve: func() (room.Media, error) { return room.Media{}, ErrLive }}
	if _, err := NewCatalog(db, 1, quiet(), still).Resolve(ctx, "https://x.test/"+id); !errors.Is(err, ErrLive) {
		t.Fatalf("err = %v", err)
	}

	finished := &fakeSource{resolve: func() (room.Media, error) {
		return room.Media{Source: "fake", SourceID: id, Title: "Replay"}, nil
	}}
	media, err := NewCatalog(db, 1, quiet(), finished).Resolve(ctx, "https://x.test/"+id)
	if err != nil || media.Title != "Replay" {
		t.Fatalf("media %+v, err %v", media, err)
	}
}

func TestLiveVideosStayOutOfResults(t *testing.T) {
	db := catalogDB(t)
	ctx := context.Background()
	stream, video := "s"+ids.New(), "v"+ids.New()
	found := []room.Media{
		{Source: "fake", SourceID: stream, IsLive: true},
		{Source: "fake", SourceID: video},
	}
	catalog := NewCatalog(db, 0, quiet(), &fakeSource{})
	query := "query " + ids.New()

	fresh, err := catalog.remember(ctx, "fake", query, "", found)
	if err != nil {
		t.Fatal(err)
	}
	cached, ok, err := db.CachedSearch(ctx, "fake", query, "", time.Hour)
	if err != nil || !ok {
		t.Fatalf("cached: %v, %v", ok, err)
	}
	for name, items := range map[string][]room.Media{"fresh": fresh, "cached": cached} {
		if len(items) != 1 || items[0].SourceID != video {
			t.Fatalf("%s: %+v", name, items)
		}
	}
}
