package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/config"
	"stream2gather/internal/hub"
)

// roomsFor builds a hub that never connects, as these tests only look at its wiring.
func roomsFor(t *testing.T, cfg config.Config) *hub.Hub {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	t.Cleanup(func() { rdb.Close() })
	return newHub(cfg, nil, nil, rdb, nil, slog.Default())
}

func TestTheRoomsCanReachTheVoiceServer(t *testing.T) {
	var path string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.Write([]byte(`{}`))
	}))
	defer fake.Close()
	cfg := config.Config{LiveKit: config.LiveKit{URL: fake.URL, APIKey: "k", APISecret: strings.Repeat("s", 32)}}

	rooms := roomsFor(t, cfg)

	if rooms.LeaveCall == nil {
		t.Fatal("signing out could not end a call")
	}
	if err := rooms.LeaveCall(context.Background(), "room1", "user1"); err != nil {
		t.Fatal(err)
	}
	if path != "/twirp/livekit.RoomService/RemoveParticipant" {
		t.Fatalf("path %s", path)
	}
}

func TestNoVoiceServerMeansNoCalls(t *testing.T) {
	if rooms := roomsFor(t, config.Config{}); rooms.LeaveCall != nil {
		t.Fatal("a hub without voice has a way to leave a call")
	}
}
