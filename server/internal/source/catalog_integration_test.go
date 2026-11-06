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
	if _, err := NewCatalog(db, 1, quiet(), still).Resolve(ctx, "https://x.test/"+id, nil); !errors.Is(err, ErrLive) {
		t.Fatalf("err = %v", err)
	}

	finished := &fakeSource{resolve: func() (room.Media, error) {
		return room.Media{Source: "fake", SourceID: id, Title: "Replay"}, nil
	}}
	media, err := NewCatalog(db, 1, quiet(), finished).Resolve(ctx, "https://x.test/"+id, nil)
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

// metered costs quota, under a name no other test run shares.
type metered struct {
	fakeSource
	name  string
	calls int
}

func (m *metered) Metered()     {}
func (m *metered) Name() string { return m.name }
func (m *metered) Resolve(ctx context.Context, ref Ref) (room.Media, error) {
	m.calls++
	return m.fakeSource.Resolve(ctx, ref)
}

func deadLinks() *metered {
	return &metered{name: "metered" + ids.New(), fakeSource: fakeSource{
		resolve: func() (room.Media, error) { return room.Media{}, ErrUnavailable },
	}}
}

func TestLookupBudgetStopsPayingForDeadLinks(t *testing.T) {
	ctx := context.Background()
	source := deadLinks()
	catalog := NewCatalog(catalogDB(t), 0, quiet(), source)
	catalog.LookupBudget = 2

	for range 2 {
		if _, err := catalog.Resolve(ctx, "https://x.test/"+ids.New(), nil); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("err = %v", err)
		}
	}
	_, err := catalog.Resolve(ctx, "https://x.test/"+ids.New(), nil)
	if !errors.Is(err, ErrLinksResting) || !IsUserError(err) {
		t.Fatalf("err = %v", err)
	}
	if source.calls != 2 {
		t.Fatalf("%d calls to the source, want 2", source.calls)
	}
}

func TestOnlyLookupsTheCacheCannotAnswerAreCharged(t *testing.T) {
	db := catalogDB(t)
	ctx := context.Background()
	id := ids.New()
	if err := db.PutMedia(ctx, []room.Media{{Source: "fake", SourceID: id}}); err != nil {
		t.Fatal(err)
	}
	source := deadLinks()
	catalog := NewCatalog(db, 0, quiet(), source)
	charged := 0
	charge := func(context.Context) error {
		charged++
		return ErrTooManyLinks
	}

	if _, err := catalog.Resolve(ctx, "https://x.test/"+id, charge); err != nil {
		t.Fatal(err)
	}
	if charged != 0 {
		t.Fatalf("a cached link cost %d", charged)
	}
	if _, err := catalog.Resolve(ctx, "https://x.test/"+ids.New(), charge); !errors.Is(err, ErrTooManyLinks) {
		t.Fatalf("err = %v", err)
	}
	if charged != 1 || source.calls != 0 {
		t.Fatalf("charged %d, source called %d times: a refused charge must stop the call", charged, source.calls)
	}
}

func TestSourcesThatCostNothingAreNotCharged(t *testing.T) {
	ctx := context.Background()
	catalog := NewCatalog(catalogDB(t), 0, quiet(), Direct{})
	refuse := func(context.Context) error { return ErrTooManyLinks }
	if _, err := catalog.Resolve(ctx, "https://x.test/"+ids.New()+".mp4", refuse); err != nil {
		t.Fatal(err)
	}
}

// Hiding a refused video would leave people wondering where it went, and a mark
// may be wrong for them, so it stays findable with the working videos above it.
func TestRefusedVideosSinkInFreshAndCachedSearch(t *testing.T) {
	db := catalogDB(t)
	ctx := context.Background()
	refused, fine := ids.New(), ids.New()
	first := room.Media{Source: "fake", SourceID: refused, Title: "refused"}
	second := room.Media{Source: "fake", SourceID: fine, Title: "fine"}
	if err := db.PutMedia(ctx, []room.Media{first, second}); err != nil {
		t.Fatal(err)
	}
	if err := db.MarkEmbedBlocked(ctx, "fake", refused); err != nil {
		t.Fatal(err)
	}
	catalog := NewCatalog(db, 10, quiet(), &fakeSource{})

	check := func(name string, items []room.Media) {
		t.Helper()
		if len(items) != 2 || items[0].SourceID != fine || items[1].SourceID != refused {
			t.Fatalf("%s: order = %+v", name, items)
		}
		if items[0].Refused || !items[1].Refused {
			t.Fatalf("%s: marks = %+v", name, items)
		}
	}

	query := "q" + ids.New()
	fresh, err := catalog.remember(ctx, "fake", query, "", []room.Media{first, second})
	if err != nil {
		t.Fatal(err)
	}
	check("fresh", fresh)

	cached, found, err := db.CachedSearch(ctx, "fake", query, "", time.Hour)
	if err != nil || !found {
		t.Fatal(found, err)
	}
	check("cached", cached)
}
