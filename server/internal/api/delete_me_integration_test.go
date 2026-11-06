package api

import (
	"context"
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
