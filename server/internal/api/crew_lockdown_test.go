package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/store"
	"stream2gather/internal/testenv"
)

func TestSomeoneLingeringInALockedRoomGetsNoVoice(t *testing.T) {
	s, pool := stackServer(t)
	s.Voice = testLiveKit
	_, owner := signUp(t, s, "Hana")
	slug := membersOnly(t, s, pool, owner)
	record, err := s.DB.RoomBySlug(context.Background(), slug)
	if err != nil {
		t.Fatal(err)
	}
	claims, stranger := signUp(t, s, "Eve")
	present(t, s, record.ID, claims.Subject, "Eve")

	response, body := serve(s, http.MethodPost, "/v1/rooms/"+slug+"/voice-token", "", stranger)

	if response.Code != http.StatusForbidden || body["code"] != "members_only" {
		t.Fatalf("a stranger got %d %v", response.Code, body)
	}
}

func TestACrewMemberStillGetsVoiceInALockedRoom(t *testing.T) {
	s, pool := stackServer(t)
	s.Voice = testLiveKit
	claims, owner := signUp(t, s, "Hana")
	slug := membersOnly(t, s, pool, owner)
	record, err := s.DB.RoomBySlug(context.Background(), slug)
	if err != nil {
		t.Fatal(err)
	}
	present(t, s, record.ID, claims.Subject, "Hana")

	response, body := serve(s, http.MethodPost, "/v1/rooms/"+slug+"/voice-token", "", owner)

	if response.Code != http.StatusOK {
		t.Fatalf("the owner got %d %v", response.Code, body)
	}
}

func TestLockingARoomTellsItsSockets(t *testing.T) {
	s, _ := stackServer(t)
	_, owner := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, owner)
	record, err := s.DB.RoomBySlug(context.Background(), slug)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rdb := redis.NewClient(&redis.Options{Addr: testenv.RedisAddr()})
	defer rdb.Close()
	listening := rdb.Subscribe(ctx, store.Channel(record.ID))
	defer listening.Close()
	if _, err := listening.Receive(ctx); err != nil {
		t.Fatal(err)
	}
	next := func(body string) string {
		t.Helper()
		if response, _ := serve(s, http.MethodPatch, "/v1/crews/"+slug, body, owner); response.Code != http.StatusOK {
			t.Fatalf("%s: %d", body, response.Code)
		}
		message, err := listening.ReceiveMessage(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return message.Payload
	}

	if event := next(`{"name":"Sunday club"}`); strings.Contains(event, "membersOnly") {
		t.Fatalf("renaming locked the room: %s", event)
	}
	if event := next(`{"guestAccess":true}`); strings.Contains(event, "membersOnly") {
		t.Fatalf("opening the room locked it: %s", event)
	}
	if event := next(`{"guestAccess":false}`); !strings.Contains(event, `"membersOnly":true`) {
		t.Fatalf("locking the room said %s", event)
	}
}
