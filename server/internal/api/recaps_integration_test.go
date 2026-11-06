package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"stream2gather/internal/store"
)

// recapParty ends a two-person session that has a biggest moment, and returns it.
func recapParty(t *testing.T, s *Server, crewID, source, sourceID, hana string) (sessionID string) {
	t.Helper()
	ctx := context.Background()
	if err := s.DB.EnsureUser(ctx, "u_guest", "Mika"); err != nil {
		t.Fatal(err)
	}
	moment := func(user, name string, pos int64) store.CapturedMoment {
		return store.CapturedMoment{Kind: "reaction", UserID: user, Author: name, Emoji: "🔥", Source: source, SourceID: sourceID, PosMs: pos, At: time.Now()}
	}
	err := s.DB.RecordCapture(ctx, store.Capture{
		CrewID: crewID, At: time.Now(), Playing: true, Source: source, SourceID: sourceID,
		Present: []store.Person{{UserID: hana, Name: "Hana", Member: true}, {UserID: "u_guest", Name: "Mika"}},
		Moments: []store.CapturedMoment{moment(hana, "Hana", 1000), moment("u_guest", "Mika", 2000), moment(hana, "Hana", 3000)},
	})
	if err != nil {
		t.Fatal(err)
	}
	open, err := s.DB.OpenSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, session := range open {
		if crew, _ := s.DB.CrewIDOfRoom(ctx, session.RoomID); crew == crewID {
			if _, err := s.DB.EndSession(ctx, session.ID, time.Now()); err != nil {
				t.Fatal(err)
			}
			return session.ID
		}
	}
	t.Fatal("no session opened")
	return ""
}

func TestARecapIsForMembersAndSaysSoWhileItBuilds(t *testing.T) {
	s, _ := stackServer(t)
	owner, as := signUp(t, s, "Hana")
	_, stranger := signUp(t, s, "Stranger")
	slug, _ := newCrew(t, s, as)
	_, crewID := crewIDOf(t, s, slug)
	media := seedMedia(t, s, "test", "Marker title")
	sessionID := recapParty(t, s, crewID, "test", media.SourceID, owner.Subject)
	path := "/v1/crews/" + slug + "/sessions/" + sessionID + "/recap"

	if response, _ := serve(s, http.MethodGet, path, "", stranger); response.Code != http.StatusForbidden {
		t.Fatalf("stranger: %d", response.Code)
	}
	if response, body := serve(s, http.MethodGet, path, "", as); response.Code != http.StatusOK || body["building"] != true {
		t.Fatalf("before the build: %d %s", response.Code, response.Body)
	}

	if err := s.DB.BuildRecap(context.Background(), sessionID); err != nil {
		t.Fatal(err)
	}

	response, body := serve(s, http.MethodGet, path, "", as)
	items, _ := body["items"].([]any)
	if response.Code != http.StatusOK || len(items) != 1 || body["attended"] != true {
		t.Fatalf("recap: %d %s", response.Code, response.Body)
	}
	if items[0].(map[string]any)["media"].(map[string]any)["title"] != "Marker title" {
		t.Fatalf("title should be joined when read: %s", response.Body)
	}
	biggest := body["biggest"].(map[string]any)
	if biggest["itemId"] == nil || biggest["emojis"].(map[string]any)["🔥"] != float64(3) {
		t.Fatalf("biggest: %s", response.Body)
	}
}

func TestAStaleVideoLosesItsTitleAndItsReliveLink(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	_, crewID := crewIDOf(t, s, slug)
	media := seedMedia(t, s, "test", "Old title")
	sessionID := recapParty(t, s, crewID, "test", media.SourceID, owner.Subject)
	if err := s.DB.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE media SET fetched_at = now() - interval '31 days' WHERE source_id = $1`, media.SourceID); err != nil {
		t.Fatal(err)
	}

	response, body := serve(s, http.MethodGet, "/v1/crews/"+slug+"/sessions/"+sessionID+"/recap", "", as)

	if strings.Contains(response.Body.String(), "Old title") || body["items"].([]any)[0].(map[string]any)["media"] != nil {
		t.Fatalf("stale title came through: %s", response.Body)
	}
	if biggest := body["biggest"].(map[string]any); biggest["itemId"] != nil {
		t.Fatalf("a video that can't play can't be relived: %s", response.Body)
	}
}

func TestDeletingAnAccountTakesItsNameOutOfRecaps(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	_, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	leaver, leaverAs := signUp(t, s, "Mika")
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, leaverAs); response.Code != http.StatusOK {
		t.Fatalf("join: %d", response.Code)
	}
	_, crewID := crewIDOf(t, s, slug)
	sessionID := watchParty(t, s, crewID, "a", store.Person{UserID: leaver.Subject, Name: "Mika", Member: true})
	if err := s.DB.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}

	if response, _ := serve(s, http.MethodDelete, "/v1/me", "", leaverAs); response.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", response.Code, response.Body)
	}

	var doc string
	if err := pool.QueryRow(ctx, `SELECT doc::text FROM session_recaps WHERE session_id = $1`, sessionID).Scan(&doc); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(doc, "Mika") || !strings.Contains(doc, "Former member") {
		t.Fatal(doc)
	}
}
