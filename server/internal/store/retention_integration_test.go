package store

import (
	"context"
	"testing"
	"time"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
)

func newOwner(t *testing.T, db *Postgres) string {
	t.Helper()
	id := "g_" + ids.New()
	if err := db.EnsureUser(context.Background(), id, "Owner"); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestClosingARoomDropsTheTitlesInItsSnapshot(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	id := ids.New()
	if err := db.CreateRoom(ctx, Room{ID: id, Slug: id, Name: "Room", OwnerID: newOwner(t, db)}); err != nil {
		t.Fatal(err)
	}
	state := room.New()
	state.Queue = []room.Item{{ID: "a", Media: room.Media{Title: "Marker title"}}}
	if err := db.SaveSnapshot(ctx, id, state); err != nil {
		t.Fatal(err)
	}
	if _, err := db.pool.Exec(ctx, `UPDATE rooms SET expires_at = now() - interval '1 hour' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}

	if _, err := db.CloseExpiredRooms(ctx); err != nil {
		t.Fatal(err)
	}

	var closed bool
	var snapshot []byte
	err := db.pool.QueryRow(ctx, `SELECT closed_at IS NOT NULL, snapshot FROM rooms WHERE id = $1`, id).Scan(&closed, &snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !closed || snapshot != nil {
		t.Fatalf("closed = %v, snapshot = %s", closed, snapshot)
	}
}

func TestSearchPurgeKeepsWhatCanStillBeServed(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	old, fresh := "old "+ids.New(), "fresh "+ids.New()
	for _, query := range []string{old, fresh} {
		if err := db.PutSearch(ctx, "youtube", query, "", []string{"a"}); err != nil {
			t.Fatal(err)
		}
	}
	_, err := db.pool.Exec(ctx, `UPDATE search_cache SET fetched_at = now() - interval '8 days' WHERE query_norm = $1`, old)
	if err != nil {
		t.Fatal(err)
	}

	purged, err := db.PurgeSearches(ctx, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if purged < 1 {
		t.Fatalf("purged %d", purged)
	}
	var left int
	err = db.pool.QueryRow(ctx, `SELECT count(*) FROM search_cache WHERE query_norm = ANY($1)`, []string{old, fresh}).Scan(&left)
	if err != nil {
		t.Fatal(err)
	}
	if left != 1 {
		t.Fatalf("%d of the two rows left, want the fresh one", left)
	}
}

func TestStaleCountSeesOnlyWhatIsPastDue(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	source := "test-" + ids.New()
	media := []room.Media{{Source: source, SourceID: "old"}, {Source: source, SourceID: "new"}}
	if err := db.PutMedia(ctx, media); err != nil {
		t.Fatal(err)
	}
	_, err := db.pool.Exec(ctx, `
		UPDATE media SET fetched_at = now() - interval '26 days' WHERE source = $1 AND source_id = 'old'`, source)
	if err != nil {
		t.Fatal(err)
	}
	count, err := db.CountStaleMedia(ctx, source, 25*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("count = %d", count)
	}
}

func TestFreshMediaLeavesOutWhatIsPastTheLimit(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	source := "test-" + ids.New()
	if err := db.PutMedia(ctx, []room.Media{{Source: source, SourceID: "new"}, {Source: source, SourceID: "old"}}); err != nil {
		t.Fatal(err)
	}
	_, err := db.pool.Exec(ctx, `
		UPDATE media SET fetched_at = now() - interval '31 days' WHERE source = $1 AND source_id = 'old'`, source)
	if err != nil {
		t.Fatal(err)
	}
	queue := []room.Item{
		{Media: room.Media{Source: source, SourceID: "new"}},
		{Media: room.Media{Source: source, SourceID: "old"}},
		{Media: room.Media{Source: source, SourceID: "missing"}},
	}
	fresh, err := db.FreshMedia(ctx, queue)
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh) != 1 || fresh[0].SourceID != "new" {
		t.Fatalf("fresh = %+v", fresh)
	}
}
