package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// watchParty runs one session in a crew and ends it, and returns its id.
func watchParty(t *testing.T, s *Server, crewID, sourceID string, people ...store.Person) string {
	t.Helper()
	ctx := context.Background()
	err := s.DB.RecordCapture(ctx, store.Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "test", SourceID: sourceID, Present: people})
	if err != nil {
		t.Fatal(err)
	}
	open, err := s.DB.OpenSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, session := range open {
		crew, err := s.DB.CrewIDOfRoom(ctx, session.RoomID)
		if err != nil {
			t.Fatal(err)
		}
		if crew == crewID {
			if _, err := s.DB.EndSession(ctx, session.ID, time.Now()); err != nil {
				t.Fatal(err)
			}
			return session.ID
		}
	}
	t.Fatal("no session opened")
	return ""
}

func crewIDOf(t *testing.T, s *Server, slug string) (store.Room, string) {
	t.Helper()
	ctx := context.Background()
	record, err := s.DB.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	crewID, err := s.DB.CrewIDOfRoom(ctx, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	return record, crewID
}

func TestSessionHistoryIsForMembersAndJoinsTitlesFresh(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	_, stranger := signUp(t, s, "Stranger")
	slug, _ := newCrew(t, s, as)
	_, crewID := crewIDOf(t, s, slug)
	kept, stale := seedMedia(t, s, "test", "Marker title"), seedMedia(t, s, "test", "Old title")
	hana := store.Person{UserID: owner.Subject, Name: "Hana", Member: true}
	watchParty(t, s, crewID, kept.SourceID, hana)
	watchParty(t, s, crewID, stale.SourceID, hana)
	if _, err := pool.Exec(ctx, `UPDATE media SET fetched_at = now() - interval '31 days' WHERE source_id = $1`, stale.SourceID); err != nil {
		t.Fatal(err)
	}

	path := "/v1/crews/" + slug + "/sessions"
	if response, _ := serve(s, http.MethodGet, path, "", stranger); response.Code != http.StatusForbidden {
		t.Fatalf("stranger: %d", response.Code)
	}
	response, body := serve(s, http.MethodGet, path, "", as)
	items, _ := body["items"].([]any)
	if response.Code != http.StatusOK || len(items) != 2 {
		t.Fatalf("history: %d %s", response.Code, response.Body)
	}
	newest := items[0].(map[string]any)["videos"].([]any)[0].(map[string]any)
	oldest := items[1].(map[string]any)["videos"].([]any)[0].(map[string]any)
	if newest["media"] != nil || oldest["media"].(map[string]any)["title"] != "Marker title" {
		t.Fatalf("a video past 30 days must lose its title: %s", response.Body)
	}
}

func TestNonMembersOnlyReadChatFromTheOpenSession(t *testing.T) {
	s, _ := stackServer(t)
	ctx := context.Background()
	hana, as := signUp(t, s, "Hana")
	_, guest := signUp(t, s, "Guest")
	slug, _ := newCrew(t, s, as)
	record, crewID := crewIDOf(t, s, slug)
	if _, err := s.DB.InsertMessage(ctx, record.ID, store.Message{UserID: hana.Subject, Author: "Old", Body: "before the party"}); err != nil {
		t.Fatal(err)
	}
	path := "/v1/rooms/" + slug + "/messages"
	read := func(as func(*http.Request)) int {
		response, body := serve(s, http.MethodGet, path, "", as)
		if response.Code != http.StatusOK {
			t.Fatalf("read: %d %s", response.Code, response.Body)
		}
		items, _ := body["items"].([]any)
		return len(items)
	}
	if got := read(guest); got != 0 {
		t.Fatalf("a guest read %d messages with no session open", got)
	}

	time.Sleep(5 * time.Millisecond)
	err := s.DB.RecordCapture(ctx, store.Capture{CrewID: crewID, At: time.Now(), Playing: true, Source: "test", SourceID: "a"})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, err := s.DB.InsertMessage(ctx, record.ID, store.Message{UserID: hana.Subject, Author: "New", Body: "during it"}); err != nil {
		t.Fatal(err)
	}

	if got := read(guest); got != 1 {
		t.Fatalf("a guest read %d messages, want the one from this session", got)
	}
	if got := read(as); got != 2 {
		t.Fatalf("a member read %d messages", got)
	}

	ephemeral := store.Room{ID: ids.New(), Slug: ids.Slug(), Name: "Room", OwnerID: hana.Subject}
	if err := s.DB.CreateRoom(ctx, ephemeral); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.InsertMessage(ctx, ephemeral.ID, store.Message{UserID: hana.Subject, Author: "Old", Body: "free"}); err != nil {
		t.Fatal(err)
	}
	path = "/v1/rooms/" + ephemeral.Slug + "/messages"
	if got := read(guest); got != 1 {
		t.Fatalf("a room with no crew changed: %d messages", got)
	}
}

func TestAVideoLeavingMediaLeavesEveryPlaceThatRememberedIt(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	owner, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	_, crewID := crewIDOf(t, s, slug)
	gone, stays := seedMedia(t, s, "test", "Gone"), seedMedia(t, s, "test", "Stays")
	if err := s.DB.AddWatch(ctx, crewID, "test", gone.SourceID, owner.Subject); err != nil {
		t.Fatal(err)
	}
	moment := func(media room.Media) store.CapturedMoment {
		return store.CapturedMoment{Kind: "reaction", UserID: owner.Subject, Author: "Hana", Emoji: "🔥", Source: "test", SourceID: media.SourceID, At: time.Now()}
	}
	err := s.DB.RecordCapture(ctx, store.Capture{
		CrewID: crewID, At: time.Now(), Playing: true, Source: "test", SourceID: gone.SourceID,
		Moments: []store.CapturedMoment{moment(gone), moment(stays)},
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := s.DB.DeleteMedia(ctx, "test", []string{gone.SourceID}); err != nil {
		t.Fatal(err)
	}

	count := func(query string) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, query, crewID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if got := count(`SELECT count(*) FROM watchlist_items WHERE crew_id = $1`); got != 0 {
		t.Fatalf("%d watchlist rows", got)
	}
	if got := count(`SELECT count(*) FROM moments WHERE crew_id = $1`); got != 1 {
		t.Fatalf("%d moments, want only the other video's", got)
	}
	if got := count(`SELECT count(*) FROM session_items i JOIN crew_sessions c ON c.id = i.session_id WHERE c.crew_id = $1 AND i.source_id IS NULL`); got != 1 {
		t.Fatalf("%d session items forgot the video", got)
	}
}

func TestDeletingAnAccountTakesItsMomentsAndItsNameFromHistory(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	_, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	leaver, leaverAs := signUp(t, s, "Mika")
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, leaverAs); response.Code != http.StatusOK {
		t.Fatalf("join: %d", response.Code)
	}
	_, crewID := crewIDOf(t, s, slug)
	err := s.DB.RecordCapture(ctx, store.Capture{
		CrewID: crewID, At: time.Now(), Playing: true, Source: "test", SourceID: "a",
		Present: []store.Person{{UserID: leaver.Subject, Name: "Mika", Member: true}},
		Moments: []store.CapturedMoment{{Kind: "reaction", UserID: leaver.Subject, Author: "Mika", Emoji: "🔥", Source: "test", SourceID: "a", At: time.Now()}},
	})
	if err != nil {
		t.Fatal(err)
	}

	if response, _ := serve(s, http.MethodDelete, "/v1/me", "", leaverAs); response.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", response.Code, response.Body)
	}

	var moments int
	var name string
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM moments WHERE user_id = $1`, leaver.Subject).Scan(&moments); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT display_name FROM session_people WHERE user_id = $1`, leaver.Subject).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if moments != 0 || name != "Former member" {
		t.Fatalf("%d moments, name %q", moments, name)
	}
}
