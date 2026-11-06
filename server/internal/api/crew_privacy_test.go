package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// membersOnly is a crew room with something to hide: a video, someone here, and a
// line of chat.
func membersOnly(t *testing.T, s *Server, pool *pgxpool.Pool, as func(*http.Request)) (slug string) {
	t.Helper()
	ctx := context.Background()
	slug, _ = newCrew(t, s, as)
	record, err := s.DB.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE crews SET guest_access = false WHERE room_id = $1`, record.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.Live.Mutate(ctx, record.ID, func(state room.State) (room.State, error) {
		next, _, err := room.Apply(state, room.Actor{System: true}, room.Command{
			Type: room.CmdQueueAdd, NewItemID: "item1",
			Media: &room.Media{Source: "direct", SourceID: "x", URL: "https://a.test/x.mp4", Title: "The secret film"},
		}, 1)
		return next, err
	}, func(room.State) ([]byte, error) { return []byte(`{}`), nil })
	if err != nil {
		t.Fatal(err)
	}
	person := store.Person{UserID: record.OwnerID, Name: "Hana", Role: room.RoleHost}
	if err := s.Live.Touch(ctx, record.ID, ids.New(), person); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.InsertMessage(ctx, record.ID, store.Message{UserID: record.OwnerID, Author: "Hana", Body: "the surprise is on friday"}); err != nil {
		t.Fatal(err)
	}
	return slug
}

func stranger(t *testing.T, s *Server) func(*http.Request) {
	t.Helper()
	return signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Stranger"})
}

func TestAStrangerCannotReadAMembersOnlyRoomsChat(t *testing.T) {
	s, pool := stackServer(t)
	_, owner := signUp(t, s, "Hana")
	slug := membersOnly(t, s, pool, owner)

	response, body := serve(s, http.MethodGet, "/v1/rooms/"+slug+"/messages", "", stranger(t, s))
	if response.Code != http.StatusForbidden || body["code"] != "members_only" {
		t.Fatalf("a stranger got %d: %s", response.Code, response.Body)
	}
	response, _ = serve(s, http.MethodGet, "/v1/rooms/"+slug+"/messages", "", owner)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "friday") {
		t.Fatalf("a member got %d: %s", response.Code, response.Body)
	}
}

func TestAStrangerCannotSeeInsideAMembersOnlyRoom(t *testing.T) {
	s, pool := stackServer(t)
	_, owner := signUp(t, s, "Hana")
	slug := membersOnly(t, s, pool, owner)

	for name, as := range map[string]func(*http.Request){"a guest": stranger(t, s), "nobody": fresh()} {
		response, _ := serve(s, http.MethodGet, "/v1/rooms/"+slug, "", as)
		text := response.Body.String()
		if response.Code != http.StatusOK || strings.Contains(text, "secret film") || strings.Contains(text, `"Hana"`) {
			t.Fatalf("%s saw %d: %s", name, response.Code, text)
		}
	}
	response, _ := serve(s, http.MethodGet, "/v1/rooms/"+slug, "", owner)
	if !strings.Contains(response.Body.String(), "secret film") || !strings.Contains(response.Body.String(), `"Hana"`) {
		t.Fatalf("a member saw %s", response.Body)
	}
}

func TestALinkCardDoesNotGiveAwayAMembersOnlyRoom(t *testing.T) {
	s, pool := stackServer(t)
	s.WebDir = t.TempDir()
	page := []byte("<html><head><title>Stream2Gather</title></head></html>")
	if err := os.WriteFile(filepath.Join(s.WebDir, "index.html"), page, 0o600); err != nil {
		t.Fatal(err)
	}
	_, owner := signUp(t, s, "Hana")
	slug := membersOnly(t, s, pool, owner)

	response, _ := serve(s, http.MethodGet, "/r/"+slug, "")
	if text := response.Body.String(); response.Code != http.StatusOK || strings.Contains(text, "secret film") {
		t.Fatalf("the card said %d %s", response.Code, text)
	}
}

func TestAnOpenCrewRoomStaysOpen(t *testing.T) {
	s, _ := stackServer(t)
	_, owner := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, owner)
	if response, _ := serve(s, http.MethodGet, "/v1/rooms/"+slug+"/messages", "", stranger(t, s)); response.Code != http.StatusOK {
		t.Fatalf("a guest in an open crew room got %d", response.Code)
	}
}
