package api

import (
	"context"
	"net/http"
	"sync"
	"testing"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// signUp makes an account and returns its identity and a request option carrying it.
func signUp(t *testing.T, s *Server, name string) (auth.Claims, func(*http.Request)) {
	t.Helper()
	account, err := s.DB.LinkClerkUser(context.Background(), "user_"+ids.New(), "", "u_"+ids.New(), name, "")
	if err != nil {
		t.Fatal(err)
	}
	claims := auth.Claims{Subject: account.ID, Name: name, Account: true, Version: account.SessionVersion}
	return claims, signedIn(t, s, claims)
}

// fresh gives each request its own address, so the room limit stays out of the way.
func fresh() func(*http.Request) { return from(ids.New()) }

func newCrew(t *testing.T, s *Server, as func(*http.Request)) (slug, token string) {
	t.Helper()
	response, body := serve(s, http.MethodPost, "/v1/crews", `{"name":"Movie night"}`, as, fresh())
	if response.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", response.Code, response.Body)
	}
	return body["slug"].(string), body["inviteToken"].(string)
}

func TestCreatingACrewMakesAPermanentRoomWithItsOwnerOnTheRoster(t *testing.T) {
	s, pool := stackServer(t)
	_, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	if len(token) < 26 {
		t.Fatalf("token %q is under 128 bits", token)
	}

	var temporary, expires bool
	err := pool.QueryRow(context.Background(), `
		SELECT is_temporary, expires_at IS NOT NULL FROM rooms WHERE slug = $1`, slug).Scan(&temporary, &expires)
	if err != nil || temporary || expires {
		t.Fatalf("temporary = %v, expires = %v, err = %v", temporary, expires, err)
	}
	response, body := serve(s, http.MethodGet, "/v1/rooms/"+slug, "", as)
	crew, _ := body["crew"].(map[string]any)
	if response.Code != http.StatusOK || crew["isMember"] != true || crew["memberCount"] != 1.0 {
		t.Fatalf("preview: %d %s", response.Code, response.Body)
	}
}

func TestGuestsCanWatchACrewRoomButNotHoldACrew(t *testing.T) {
	s, _ := stackServer(t)
	guest := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Guest"})
	if response, _ := serve(s, http.MethodPost, "/v1/crews", `{"name":"Nope"}`, guest, fresh()); response.Code != http.StatusUnauthorized {
		t.Fatalf("create as guest: %d", response.Code)
	}
	_, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	response, body := serve(s, http.MethodGet, "/v1/rooms/"+slug, "", guest)
	crew, _ := body["crew"].(map[string]any)
	if response.Code != http.StatusOK || crew["memberCount"] != 1.0 || crew["isMember"] != false || crew["guestAccess"] != true {
		t.Fatalf("preview: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodPost, "/v1/rooms/"+slug+"/ticket", "", guest); response.Code != http.StatusOK {
		t.Fatalf("ticket as guest: %d %s", response.Code, response.Body)
	}
}

func TestOwnerLimitHoldsUnderParallelCreates(t *testing.T) {
	s, _ := stackServer(t)
	_, as := signUp(t, s, "Hana")
	codes := make(chan int, store.MaxOwnedCrews+6)
	var group sync.WaitGroup
	for range cap(codes) {
		group.Go(func() {
			response, _ := serve(s, http.MethodPost, "/v1/crews", `{"name":"Crew"}`, as, fresh())
			codes <- response.Code
		})
	}
	group.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[http.StatusCreated] != store.MaxOwnedCrews || counts[http.StatusConflict] != 6 {
		t.Fatalf("codes = %v", counts)
	}
}

func TestJoiningNeedsTheInviteAndStopsAtFifty(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	joinPath := "/v1/crews/" + slug + "/join"
	body := `{"token":"` + token + `"}`

	friend, friendAs := signUp(t, s, "Mika")
	if response, got := serve(s, http.MethodPost, joinPath, `{"token":"wrong"}`, friendAs); response.Code != http.StatusForbidden || got["code"] != "invalid_invite" {
		t.Fatalf("wrong token: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/crews/"+slug, "", friendAs); response.Code != http.StatusForbidden {
		t.Fatalf("home before joining: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPost, joinPath, body, friendAs); response.Code != http.StatusOK {
		t.Fatalf("join: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodPost, joinPath, `{"token":"old"}`, friendAs); response.Code != http.StatusOK {
		t.Fatalf("a member's old link must still work: %d", response.Code)
	}
	response, home := serve(s, http.MethodGet, "/v1/crews/"+slug, "", friendAs)
	if response.Code != http.StatusOK || home["name"] != "Movie night" || home["ownerId"] != owner.Subject {
		t.Fatalf("home: %d %s", response.Code, response.Body)
	}
	roster := home["roster"].([]any)
	if len(roster) != 2 || roster[0].(map[string]any)["userId"] != owner.Subject || roster[1].(map[string]any)["userId"] != friend.Subject {
		t.Fatalf("roster: %s", response.Body)
	}

	var crewID string
	err := pool.QueryRow(ctx, `SELECT c.id FROM crews c JOIN rooms r ON r.id = c.room_id WHERE r.slug = $1`, slug).Scan(&crewID)
	if err != nil {
		t.Fatal(err)
	}
	for range store.MaxCrewMembers - 3 {
		extra, _ := signUp(t, s, "Extra")
		if _, err := pool.Exec(ctx, `INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)`, crewID, extra.Subject); err != nil {
			t.Fatal(err)
		}
	}
	// The last place goes to one of these, whatever order they arrive in.
	codes := make(chan int, 2)
	var group sync.WaitGroup
	for range cap(codes) {
		group.Go(func() {
			_, late := signUp(t, s, "Late")
			response, _ := serve(s, http.MethodPost, joinPath, body, late)
			codes <- response.Code
		})
	}
	group.Wait()
	if first, second := <-codes, <-codes; first+second != http.StatusOK+http.StatusConflict {
		t.Fatalf("racing for the last place: %d and %d", first, second)
	}
}

func TestGuestsGetNoCrewHomeOrMembership(t *testing.T) {
	s, _ := stackServer(t)
	_, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	guest := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Guest"})
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, guest); response.Code != http.StatusUnauthorized {
		t.Fatalf("join as guest: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/crews/"+slug, "", guest); response.Code != http.StatusUnauthorized {
		t.Fatalf("home as guest: %d", response.Code)
	}
}

func TestMembersOnlyRoomTurnsNonMembersAwayAtTheTicket(t *testing.T) {
	s, pool := stackServer(t)
	owner, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	if _, err := pool.Exec(context.Background(), `
		UPDATE crews SET guest_access = false WHERE room_id = (SELECT id FROM rooms WHERE slug = $1)`, slug); err != nil {
		t.Fatal(err)
	}
	guest := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Guest"})
	response, body := serve(s, http.MethodPost, "/v1/rooms/"+slug+"/ticket", "", guest)
	if response.Code != http.StatusForbidden || body["code"] != "members_only" {
		t.Fatalf("guest: %d %s", response.Code, response.Body)
	}

	response, body = serve(s, http.MethodPost, "/v1/rooms/"+slug+"/ticket", "", as)
	if response.Code != http.StatusOK {
		t.Fatalf("member: %d %s", response.Code, response.Body)
	}
	ticket, found, err := s.Live.TakeTicket(context.Background(), body["ticket"].(string))
	if err != nil || !found || !ticket.Person.Member || ticket.Person.UserID != owner.Subject {
		t.Fatalf("ticket = %+v, found = %v, err = %v", ticket, found, err)
	}
}

func TestRoomWithoutACrewIsUntouched(t *testing.T) {
	s, _ := stackServer(t)
	record := newRoom(t, s, room.New())
	response, body := serve(s, http.MethodGet, "/v1/rooms/"+record.Slug, "", fresh())
	if response.Code != http.StatusOK || body["crew"] != nil {
		t.Fatalf("preview: %d %s", response.Code, response.Body)
	}
	_, as := signUp(t, s, "Hana")
	if response, _ := serve(s, http.MethodGet, "/v1/crews/"+record.Slug, "", as); response.Code != http.StatusNotFound {
		t.Fatalf("crew home: %d", response.Code)
	}
}
