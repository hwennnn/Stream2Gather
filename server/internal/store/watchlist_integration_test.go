package store

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"
)

// Capture hides what a crew has watched, so it mustn't go on taking up the list.
func TestWatchedVideosLeaveRoomOnTheList(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	for i := range MaxWatchlist {
		if err := db.AddWatch(ctx, crewID, "youtube", strconv.Itoa(i), owner); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AddWatch(ctx, crewID, "youtube", "one-more", owner); !errors.Is(err, ErrWatchlistFull) {
		t.Fatalf("a full list took another: %v", err)
	}
	if _, err := db.pool.Exec(ctx, `UPDATE watchlist_items SET watched_session_id = 's' WHERE crew_id = $1`, crewID); err != nil {
		t.Fatal(err)
	}

	if err := db.AddWatch(ctx, crewID, "youtube", "next", owner); err != nil {
		t.Fatalf("the list looks empty, and says: %v", err)
	}
}

func TestAWatchedVideoCanBeLinedUpAgain(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	if err := db.AddWatch(ctx, crewID, "youtube", "again", owner); err != nil {
		t.Fatal(err)
	}
	err := db.RecordCapture(ctx, Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "youtube", SourceID: "again"})
	if err != nil {
		t.Fatal(err)
	}
	if items, err := db.Watchlist(ctx, crewID); err != nil || len(items) != 0 {
		t.Fatalf("watched video still listed: %v, %v", items, err)
	}

	if err := db.AddWatch(ctx, crewID, "youtube", "again", owner); err != nil {
		t.Fatal(err)
	}

	if items, err := db.Watchlist(ctx, crewID); err != nil || len(items) != 1 {
		t.Fatalf("added it back and got %d items, err = %v", len(items), err)
	}
}

// Adding what's already lined up still changes nothing.
func TestAddingALinedUpVideoLeavesItAlone(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	crewID, owner := testCrew(t, db)
	for range 2 {
		if err := db.AddWatch(ctx, crewID, "youtube", "same", owner); err != nil {
			t.Fatal(err)
		}
	}
	if items, err := db.Watchlist(ctx, crewID); err != nil || len(items) != 1 {
		t.Fatalf("%d items, err = %v", len(items), err)
	}
}
