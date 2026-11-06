package api

import (
	"context"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"stream2gather/internal/recap"
	"stream2gather/internal/store"
)

func TestSharingARecapOpensItToStrangersUntilItIsTurnedOff(t *testing.T) {
	s, _ := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	_, crewID := crewIDOf(t, s, slug)
	media := seedMedia(t, s, "test", "Marker title")
	sessionID := recapParty(t, s, crewID, "test", media.SourceID, owner.Subject)
	if err := s.DB.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}
	share := "/v1/crews/" + slug + "/sessions/" + sessionID + "/recap/share"

	_, absentAs := signUp(t, s, "Absent")
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, absentAs); response.Code != http.StatusOK {
		t.Fatalf("join: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPost, share, `{"public":true}`, absentAs); response.Code != http.StatusForbidden {
		t.Fatalf("someone who wasn't there: %d", response.Code)
	}

	response, body := serve(s, http.MethodPost, share, `{"public":true}`, as)
	url, _ := body["url"].(string)
	if response.Code != http.StatusOK || !strings.Contains(url, "/s/") {
		t.Fatalf("share: %d %s", response.Code, response.Body)
	}
	shared := url[strings.LastIndex(url, "/")+1:]

	response, body = serve(s, http.MethodGet, "/v1/recaps/"+shared, "")
	if response.Code != http.StatusOK || body["videos"].([]any)[0].(map[string]any)["title"] != "Marker title" {
		t.Fatalf("public read: %d %s", response.Code, response.Body)
	}

	if response, _ := serve(s, http.MethodPost, share, `{"public":false}`, as); response.Code != http.StatusOK {
		t.Fatalf("unshare: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/recaps/"+shared, ""); response.Code != http.StatusNotFound {
		t.Fatalf("the very next read after turning it off: %d", response.Code)
	}
}

func TestThePublicRecapCarriesNoChat(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	record, crewID := crewIDOf(t, s, slug)
	media := seedMedia(t, s, "test", "Title")
	var messageID int64
	err := pool.QueryRow(ctx, `
		INSERT INTO messages (room_id, user_id, author_name, body) VALUES ($1, $2, 'Hana', 'SECRET-CHAT') RETURNING id`,
		record.ID, owner.Subject).Scan(&messageID)
	if err != nil {
		t.Fatal(err)
	}
	err = s.DB.RecordCapture(ctx, store.Capture{
		CrewID: crewID, At: time.Now(), Playing: true, Source: "test", SourceID: media.SourceID,
		Present: []store.Person{{UserID: owner.Subject, Name: "Hana", Member: true}},
		Moments: []store.CapturedMoment{{Kind: "chat", UserID: owner.Subject, Author: "Hana", MessageID: messageID, Source: "test", SourceID: media.SourceID, At: time.Now()}},
	})
	if err != nil {
		t.Fatal(err)
	}
	sessionID := recapParty(t, s, crewID, "test", media.SourceID, owner.Subject)
	if err := s.DB.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}
	_, body := serve(s, http.MethodPost, "/v1/crews/"+slug+"/sessions/"+sessionID+"/recap/share", `{"public":true}`, as)
	url := body["url"].(string)

	response, _ := serve(s, http.MethodGet, "/v1/recaps/"+url[strings.LastIndex(url, "/")+1:], "")

	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "SECRET-CHAT") {
		t.Fatalf("%d %s", response.Code, response.Body)
	}
}

func TestThePublicDotsDrawTheNightWithoutSayingWhoReacted(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	_, crewID := crewIDOf(t, s, slug)
	media := seedMedia(t, s, "test", "Title")
	if _, err := pool.Exec(ctx, `UPDATE media SET duration_ms = 100000 WHERE source = 'test' AND source_id = $1`, media.SourceID); err != nil {
		t.Fatal(err)
	}
	sessionID := recapParty(t, s, crewID, "test", media.SourceID, owner.Subject)
	if _, err := pool.Exec(ctx, `DELETE FROM moments WHERE session_id = $1`, sessionID); err != nil {
		t.Fatal(err)
	}
	add := func(posMs int64, userID, origin string) {
		t.Helper()
		_, err := pool.Exec(ctx, `
			INSERT INTO moments (crew_id, session_id, source, source_id, pos_ms, kind, origin, user_id, author_name, emoji)
			VALUES ($1, $2, 'test', $3, $4, 'reaction', $5, NULLIF($6, ''), 'MARKER-NAME', '🔥')`,
			crewID, sessionID, media.SourceID, posMs, origin, userID)
		if err != nil {
			t.Fatal(err)
		}
	}
	add(50_000, owner.Subject, "live")
	add(50_100, owner.Subject, "live") // The same place, so the same dot.
	add(75_000, "", "live")
	add(90_000, owner.Subject, "catchup")
	if err := s.DB.BuildRecap(ctx, sessionID); err != nil {
		t.Fatal(err)
	}
	_, body := serve(s, http.MethodPost, "/v1/crews/"+slug+"/sessions/"+sessionID+"/recap/share", `{"public":true}`, as)
	url := body["url"].(string)

	response, read := serve(s, http.MethodGet, "/v1/recaps/"+url[strings.LastIndex(url, "/")+1:], "")

	if response.Code != http.StatusOK {
		t.Fatalf("%d %s", response.Code, response.Body)
	}
	raw := response.Body.String()
	if strings.Contains(raw, owner.Subject) || strings.Contains(raw, "MARKER-NAME") {
		t.Fatalf("a dot says who it was: %s", raw)
	}
	dots := read["videos"].([]any)[0].(map[string]any)["dots"].([]any)
	if len(dots) != 2 {
		t.Fatalf("one dot per place, none from a catch-up: %v", dots)
	}
	first, second := dots[0].(map[string]any), dots[1].(map[string]any)
	if first["at"] != float64(50) || first["seat"] != float64(0) || second["at"] != float64(75) || second["seat"] != float64(-1) {
		t.Fatalf("%v %v", first, second)
	}
}

func TestSeatsDependOnTheLinkNotOnWhoComesFirst(t *testing.T) {
	people := []string{"u1", "u2", "u3", "u4", "u5", "u6"}
	in := func(order []string) []recap.Moment {
		moments := make([]recap.Moment, len(order))
		for i, id := range order {
			moments[i] = recap.Moment{UserID: id}
		}
		return moments
	}
	reversed := slices.Clone(people)
	slices.Reverse(reversed)

	if !maps.Equal(seatsOf("token", in(people)), seatsOf("token", in(reversed))) {
		t.Fatal("the order people reacted in showed through")
	}
	if maps.Equal(seatsOf("one", in(people)), seatsOf("two", in(people))) {
		t.Fatal("every link numbered the seats alike")
	}
}

func TestASharedLinkUnfurlsButStaysOutOfSearch(t *testing.T) {
	s, _ := stackServer(t)
	s.WebDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(s.WebDir, "index.html"), []byte("<html><head></head>app</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	owner, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	_, crewID := crewIDOf(t, s, slug)
	media := seedMedia(t, s, "test", "Marker title")
	sessionID := recapParty(t, s, crewID, "test", media.SourceID, owner.Subject)
	if err := s.DB.BuildRecap(context.Background(), sessionID); err != nil {
		t.Fatal(err)
	}
	_, body := serve(s, http.MethodPost, "/v1/crews/"+slug+"/sessions/"+sessionID+"/recap/share", `{"public":true}`, as)
	url := body["url"].(string)

	response, _ := serve(s, http.MethodGet, url[strings.LastIndex(url, "/s/"):], "")

	if response.Code != http.StatusOK || response.Header().Get("X-Robots-Tag") != "noindex" {
		t.Fatalf("%d %v", response.Code, response.Header())
	}
	if !strings.Contains(response.Body.String(), `og:title`) || !strings.Contains(response.Body.String(), "app") {
		t.Fatalf("%s", response.Body)
	}

	response, _ = serve(s, http.MethodGet, "/s/nothing", "")
	if response.Code != http.StatusNotFound || response.Header().Get("X-Robots-Tag") != "noindex" || !strings.Contains(response.Body.String(), "app") {
		t.Fatalf("unknown: %d %v", response.Code, response.Header())
	}
}
