package store

import (
	"context"
	"errors"
	"testing"

	"stream2gather/internal/ids"
)

func testEndpoint() string { return "https://fcm.googleapis.com/fcm/send/" + ids.New() }

func TestDevicesStopAtTheLimit(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	_, owner := testCrew(t, db)
	for range maxDevices + 2 {
		if _, err := db.SavePushSubscription(ctx, owner, testEndpoint(), "p256dh", "auth", ""); err != nil {
			t.Fatal(err)
		}
	}
	devices, err := db.PushDevices(ctx, owner)
	if err != nil || len(devices) != maxDevices {
		t.Fatalf("kept %d, err = %v", len(devices), err)
	}
}

// Taking over a browser saved long ago mustn't lose it to the limit, which goes by age.
func TestTakingOverAnOldBrowserKeepsIt(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	_, first := testCrew(t, db)
	_, second := testCrew(t, db)
	endpoint := testEndpoint()
	if _, err := db.SavePushSubscription(ctx, first, endpoint, "p256dh", "auth", ""); err != nil {
		t.Fatal(err)
	}
	for range maxDevices {
		if _, err := db.SavePushSubscription(ctx, second, testEndpoint(), "p256dh", "auth", ""); err != nil {
			t.Fatal(err)
		}
	}

	id, err := db.SavePushSubscription(ctx, second, endpoint, "p256dh", "auth", "")
	if err != nil {
		t.Fatal(err)
	}

	if err := db.DeletePushSubscription(ctx, second, id); err != nil {
		t.Fatalf("saved %s, but it isn't there: %v", id, err)
	}
}

func TestASecondAccountOnOneBrowserTakesItOver(t *testing.T) {
	db, ctx := testPostgres(t), context.Background()
	_, first := testCrew(t, db)
	_, second := testCrew(t, db)
	endpoint := testEndpoint()
	id, err := db.SavePushSubscription(ctx, first, endpoint, "p256dh", "auth", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.SavePushSubscription(ctx, second, endpoint, "p256dh", "auth", ""); err != nil {
		t.Fatal(err)
	}
	if err := db.DeletePushSubscription(ctx, first, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the first account still holds it: %v", err)
	}
	if devices, _ := db.PushDevices(ctx, second); len(devices) != 1 {
		t.Fatalf("second account has %d", len(devices))
	}
}
