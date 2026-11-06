package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/store"
)

func TestDeletingAnAccountHandsOverSharedCrewsAndRemovesLonelyOnes(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	shared, token := newCrew(t, s, as)
	lonely, _ := newCrew(t, s, as)
	first, firstAs := signUp(t, s, "First")
	_, secondAs := signUp(t, s, "Second")
	for _, friend := range []func(*http.Request){firstAs, secondAs} {
		if response, _ := serve(s, http.MethodPost, "/v1/crews/"+shared+"/join", `{"token":"`+token+`"}`, friend); response.Code != http.StatusOK {
			t.Fatalf("join: %d", response.Code)
		}
	}
	temporary := store.Room{ID: ids.New(), Slug: ids.Slug(), Name: "Room", OwnerID: owner.Subject}
	if err := s.DB.CreateRoom(ctx, temporary); err != nil {
		t.Fatal(err)
	}
	record, err := s.DB.RoomBySlug(ctx, shared)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.InsertMessage(ctx, record.ID, store.Message{UserID: owner.Subject, Author: "Hana", Body: "mine"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.InsertMessage(ctx, record.ID, store.Message{UserID: first.Subject, Author: "First", Body: "theirs"}); err != nil {
		t.Fatal(err)
	}

	response, _ := serve(s, http.MethodDelete, "/v1/me", "", as)
	if response.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", response.Code, response.Body)
	}
	if cookie := response.Result().Cookies(); len(cookie) != 1 || cookie[0].MaxAge >= 0 {
		t.Fatalf("cookie not cleared: %+v", cookie)
	}

	_, home := serve(s, http.MethodGet, "/v1/crews/"+shared, "", firstAs)
	if home["ownerId"] != first.Subject || len(home["roster"].([]any)) != 2 {
		t.Fatalf("home after the owner left: %v", home)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/rooms/"+lonely, "", firstAs); response.Code != http.StatusNotFound {
		t.Fatalf("lonely crew: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/rooms/"+temporary.Slug, "", firstAs); response.Code != http.StatusNotFound {
		t.Fatalf("temporary room: %d", response.Code)
	}
	var users, mine, theirs int
	err = pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM users WHERE id = $1),
		       (SELECT count(*) FROM messages WHERE user_id = $1),
		       (SELECT count(*) FROM messages WHERE user_id = $2)`, owner.Subject, first.Subject).Scan(&users, &mine, &theirs)
	if err != nil || users != 0 || mine != 0 || theirs != 1 {
		t.Fatalf("users = %d, mine = %d, theirs = %d, err = %v", users, mine, theirs, err)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/me/crews", "", as); response.Code != http.StatusUnauthorized {
		t.Fatalf("the old cookie must be dead: %d", response.Code)
	}
}

func TestGuestsHaveNoAccountToDelete(t *testing.T) {
	s, _ := stackServer(t)
	guest := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Guest"})
	if response, _ := serve(s, http.MethodDelete, "/v1/me", "", guest); response.Code != http.StatusUnauthorized {
		t.Fatalf("guest: %d", response.Code)
	}
}

// Clerk outlives the account here, so a device still signed in there could click
// Sign in and get a new account with no password.
func TestDeletingAnAccountEndsItsClerkSessions(t *testing.T) {
	test, server := sessionStack(t)
	clerk := &clerkOnTwoDevices{fakeClerk: server.Clerk.(fakeClerk)}
	server.Clerk = clerk
	cookies := signInAs(t, test, "good", nil)

	response, body := call(t, http.MethodDelete, test.URL+"/v1/me", "", cookies)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d %v", response.StatusCode, body)
	}

	if len(clerk.ended) != 1 || clerk.ended[0] != clerk.identity.ClerkID {
		t.Fatalf("ended %v, want the deleted person's Clerk id", clerk.ended)
	}
	again, _ := call(t, http.MethodPost, test.URL+"/v1/session/clerk", "good", nil)
	if again.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d: one click made a new account", again.StatusCode)
	}
}

// The account is gone by then, so saying it failed would be a lie.
func TestAClerkOutageDoesNotUndoADeletion(t *testing.T) {
	test, server := sessionStack(t)
	server.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	server.Clerk = &clerkOnTwoDevices{fakeClerk: server.Clerk.(fakeClerk), failure: errors.New("clerk is down")}
	cookies := signInAs(t, test, "good", nil)

	response, body := call(t, http.MethodDelete, test.URL+"/v1/me", "", cookies)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d %v", response.StatusCode, body)
	}
	if user := meOf(t, test, cookies); user != nil {
		t.Fatalf("still here: %v", user)
	}
}
