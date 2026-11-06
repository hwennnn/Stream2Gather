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

func TestFirstSignInMakesANewUserAndMovesTheGuestsRooms(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	guest, clerkID, newID := "g_"+ids.New(), "user_"+ids.New(), "u_"+ids.New()
	if err := db.EnsureUser(ctx, guest, "Amber panda"); err != nil {
		t.Fatal(err)
	}
	slug := ids.New()
	if err := db.CreateRoom(ctx, Room{ID: ids.New(), Slug: slug, Name: "Movie night", OwnerID: guest}); err != nil {
		t.Fatal(err)
	}

	account, err := db.LinkClerkUser(ctx, clerkID, guest, newID, "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	if account.ID != newID || account.Name != "Ada" {
		t.Fatalf("got %+v, want a new user: the old guest cookie must not become the account", account)
	}
	record, err := db.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if record.OwnerID != newID {
		t.Fatalf("room owner is %q, want %q", record.OwnerID, newID)
	}
}

func TestSignOutBumpsTheSessionVersion(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	clerkID := "user_" + ids.New()
	account, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	if account.SessionVersion != 0 {
		t.Fatalf("new account at version %d", account.SessionVersion)
	}
	if err := db.BumpSessionVersion(ctx, account.ID); err != nil {
		t.Fatal(err)
	}
	if version, err := db.SessionVersion(ctx, account.ID); err != nil || version != 1 {
		t.Fatalf("version = %d, err = %v", version, err)
	}
	again, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
	if err != nil || again.SessionVersion != 1 {
		t.Fatalf("signing in again: %+v, err = %v", again, err)
	}
	if _, err := db.SessionVersion(ctx, "u_"+ids.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown user: err = %v", err)
	}
}

func TestExistingAccountTakesOverTheGuestsRooms(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	clerkID := "user_" + ids.New()
	owner, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
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

	account, err := db.LinkClerkUser(ctx, clerkID, guest, "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	if account.ID != owner.ID {
		t.Fatalf("signed in as %q, want %q", account.ID, owner.ID)
	}
	record, err := db.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if record.OwnerID != owner.ID {
		t.Fatalf("room owner is %q, want %q", record.OwnerID, owner.ID)
	}
}

func TestAnotherAccountCannotTakeRoomsFromASignedInUser(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	first, err := db.LinkClerkUser(ctx, "user_"+ids.New(), "", "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	slug := ids.New()
	if err := db.CreateRoom(ctx, Room{ID: ids.New(), Slug: slug, Name: "Movie night", OwnerID: first.ID}); err != nil {
		t.Fatal(err)
	}

	second := "user_" + ids.New()
	if _, err := db.LinkClerkUser(ctx, second, "", "u_"+ids.New(), "Grace", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.LinkClerkUser(ctx, second, first.ID, "u_"+ids.New(), "Grace", ""); err != nil {
		t.Fatal(err)
	}
	record, err := db.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if record.OwnerID != first.ID {
		t.Fatalf("room moved to %q", record.OwnerID)
	}
}

func TestDisplayNameSurvivesSigningInAgain(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	clerkID := "user_" + ids.New()
	account, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.EnsureUser(ctx, account.ID, "Countess"); err != nil {
		t.Fatal(err)
	}
	if again, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", ""); err != nil || again.Name != "Countess" {
		t.Fatalf("name = %q, err = %v", again.Name, err)
	}
}

func TestConcurrentFirstSignInsMakeOneUser(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	clerkID := "user_" + ids.New()
	found := make([]string, 8)
	var wait sync.WaitGroup
	for i := range found {
		wait.Go(func() {
			account, err := db.LinkClerkUser(ctx, clerkID, "", "u_"+ids.New(), "Ada", "")
			if err != nil {
				t.Error(err)
			}
			found[i] = account.ID
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
