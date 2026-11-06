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
}
