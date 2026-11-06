package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"stream2gather/internal/ids"
)

// These tests need the Postgres from deploy/compose.yaml and skip without it.
func testPostgres(t *testing.T) *Postgres {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	pool, err := pgxpool.New(context.Background(), "postgres://s2g:s2g@127.0.0.1:54339/s2g?sslmode=disable")
	if err != nil {
		t.Skip("postgres not configured:", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skip("postgres not running:", err)
	}
	return NewPostgres(pool)
}

func TestGuestKeepsTheirIdentityOnFirstSignIn(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	guest, clerkID := "g_"+ids.New(), "user_"+ids.New()
	if err := db.EnsureUser(ctx, guest, "Amber panda"); err != nil {
		t.Fatal(err)
	}

	id, name, err := db.LinkClerkUser(ctx, clerkID, guest, "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	if id != guest || name != "Ada" {
		t.Fatalf("got %q %q, want the guest id and the account name", id, name)
	}
}

func TestExistingAccountTakesOverTheGuestsRooms(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	clerkID := "user_" + ids.New()
	owner, _, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}

	guest := "g_" + ids.New()
	if err := db.EnsureUser(ctx, guest, "Amber panda"); err != nil {
		t.Fatal(err)
	}
	slug := ids.New()
	if err := db.CreateRoom(ctx, Room{ID: ids.New(), Slug: slug, Name: "Movie night", OwnerID: guest}); err != nil {
		t.Fatal(err)
	}

	id, _, err := db.LinkClerkUser(ctx, clerkID, guest, "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	if id != owner {
		t.Fatalf("signed in as %q, want %q", id, owner)
	}
	record, err := db.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if record.OwnerID != owner {
		t.Fatalf("room owner is %q, want %q", record.OwnerID, owner)
	}
}

func TestAnotherAccountCannotTakeRoomsFromASignedInUser(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	first, _, err := db.LinkClerkUser(ctx, "user_"+ids.New(), "", "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	slug := ids.New()
	if err := db.CreateRoom(ctx, Room{ID: ids.New(), Slug: slug, Name: "Movie night", OwnerID: first}); err != nil {
		t.Fatal(err)
	}

	second := "user_" + ids.New()
	if _, _, err := db.LinkClerkUser(ctx, second, "", "u_"+ids.New(), "Grace", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := db.LinkClerkUser(ctx, second, first, "u_"+ids.New(), "Grace", ""); err != nil {
		t.Fatal(err)
	}
	record, err := db.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if record.OwnerID != first {
		t.Fatalf("room moved to %q", record.OwnerID)
	}
}

func TestDisplayNameSurvivesSigningInAgain(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	clerkID := "user_" + ids.New()
	id, _, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.EnsureUser(ctx, id, "Countess"); err != nil {
		t.Fatal(err)
	}
	if _, name, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", ""); err != nil || name != "Countess" {
		t.Fatalf("name = %q, err = %v", name, err)
	}
}

func TestConcurrentFirstSignInsMakeOneUser(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	clerkID := "user_" + ids.New()
	found := make([]string, 8)
	var wait sync.WaitGroup
	for i := range found {
		wait.Go(func() {
			id, _, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
			if err != nil {
				t.Error(err)
			}
			found[i] = id
		})
	}
	wait.Wait()
	for _, id := range found {
		if id != found[0] {
			t.Fatalf("got different users: %v", found)
		}
	}
}

func TestDuplicateSlugIsRecognised(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	owner := "g_" + ids.New()
	if err := db.EnsureUser(ctx, owner, "Owner"); err != nil {
		t.Fatal(err)
	}
	slug := "slug-" + ids.New()
	if err := db.CreateRoom(ctx, Room{ID: ids.New(), Slug: slug, Name: "One", OwnerID: owner}); err != nil {
		t.Fatal(err)
	}
	err := db.CreateRoom(ctx, Room{ID: ids.New(), Slug: slug, Name: "Two", OwnerID: owner})
	if !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("err = %v", err)
	}
}
