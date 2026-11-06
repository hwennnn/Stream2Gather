package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
