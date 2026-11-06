package api

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"testing"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

func seedMedia(t *testing.T, s *Server, source, title string) room.Media {
	t.Helper()
	media := room.Media{Source: source, SourceID: ids.New(), URL: "https://a.test/" + ids.New(), Title: title}
	if err := s.DB.PutMedia(context.Background(), []room.Media{media}); err != nil {
		t.Fatal(err)
	}
	return media
}

func watchBody(media room.Media) string {
	return `{"source":"` + media.Source + `","sourceId":"` + media.SourceID + `"}`
}

func TestWatchlistStoresOnlyIdsAndJoinsTitlesFresh(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	_, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	path := "/v1/crews/" + slug + "/watchlist"
	kept, stale := seedMedia(t, s, "test", "Marker title"), seedMedia(t, s, "test", "Old title")

	for _, media := range []room.Media{kept, kept, stale} {
		if response, _ := serve(s, http.MethodPost, path, watchBody(media), as); response.Code != http.StatusOK {
			t.Fatalf("add: %d %s", response.Code, response.Body)
		}
	}
	_, err := pool.Exec(ctx, `UPDATE media SET fetched_at = now() - interval '31 days' WHERE source_id = $1`, stale.SourceID)
	if err != nil {
		t.Fatal(err)
	}

	response, body := serve(s, http.MethodGet, path, "", as)
	items := body["items"].([]any)
	if response.Code != http.StatusOK || len(items) != 2 {
		t.Fatalf("list: %d %s", response.Code, response.Body)
	}
	first, second := items[0].(map[string]any), items[1].(map[string]any)
	if first["media"].(map[string]any)["title"] != "Marker title" || second["media"] != nil {
		t.Fatalf("a video past 30 days must lose its title: %s", response.Body)
	}

	_, removeBody := serve(s, http.MethodGet, "/v1/crews/"+slug, "", as)
	id := removeBody["watchlist"].([]any)[0].(map[string]any)["id"].(float64)
	if response, _ := serve(s, http.MethodDelete, path+"/"+strconv.FormatInt(int64(id), 10), "", as); response.Code != http.StatusOK {
		t.Fatalf("remove: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodDelete, path+"/"+strconv.FormatInt(int64(id), 10), "", as); response.Code != http.StatusNotFound {
		t.Fatalf("remove twice: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPost, path, watchBody(kept), as); response.Code != http.StatusOK {
		t.Fatalf("add it back: %d", response.Code)
	}
}

func TestWatchlistCreditsWhoAddedItUntilTheAccountGoes(t *testing.T) {
	s, _ := stackServer(t)
	ctx := context.Background()
	_, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	mika, mikaAs := signUp(t, s, "Mika")
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, mikaAs); response.Code != http.StatusOK {
		t.Fatalf("join: %d %s", response.Code, response.Body)
	}
	path := "/v1/crews/" + slug + "/watchlist"
	if response, _ := serve(s, http.MethodPost, path, watchBody(seedMedia(t, s, "test", "Marker title")), mikaAs); response.Code != http.StatusOK {
		t.Fatalf("add: %d %s", response.Code, response.Body)
	}

	_, body := serve(s, http.MethodGet, path, "", as)
	adder, _ := body["items"].([]any)[0].(map[string]any)["addedBy"].(map[string]any)
	if adder["userId"] != mika.Subject || adder["name"] != "Mika" {
		t.Fatalf("credit: %v", adder)
	}

	if _, err := s.DB.DeleteAccount(ctx, mika.Subject); err != nil {
		t.Fatal(err)
	}
	_, body = serve(s, http.MethodGet, path, "", as)
	if adder := body["items"].([]any)[0].(map[string]any)["addedBy"]; adder != nil {
		t.Fatalf("a deleted account is still credited: %v", adder)
	}
}

func TestOnlyMembersUseTheWatchlist(t *testing.T) {
	s, _ := stackServer(t)
	_, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	path := "/v1/crews/" + slug + "/watchlist"
	media := seedMedia(t, s, "test", "Title")
	_, stranger := signUp(t, s, "Stranger")
	guest := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Guest"})

	if response, _ := serve(s, http.MethodGet, path, "", stranger); response.Code != http.StatusForbidden {
		t.Fatalf("stranger reading: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPost, path, watchBody(media), stranger); response.Code != http.StatusForbidden {
		t.Fatalf("stranger adding: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPost, path, watchBody(media), guest); response.Code != http.StatusUnauthorized {
		t.Fatalf("guest adding: %d", response.Code)
	}
	missing := room.Media{Source: "test", SourceID: "never-fetched"}
	if response, _ := serve(s, http.MethodPost, path, watchBody(missing), as); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown video: %d", response.Code)
	}
}

func TestWatchlistLimitHoldsUnderParallelAdds(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	_, as := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, as)
	record, err := s.DB.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	crew, err := s.DB.CrewOfRoom(ctx, record)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO watchlist_items (crew_id, source, source_id)
		SELECT $1, 'test', 'seed-' || n FROM generate_series(1, $2::int) n`, crew.ID, store.MaxWatchlist-1)
	if err != nil {
		t.Fatal(err)
	}
	codes := make(chan int, 2)
	var group sync.WaitGroup
	for range cap(codes) {
		group.Go(func() {
			media := seedMedia(t, s, "test", "Title")
			response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/watchlist", watchBody(media), as)
			codes <- response.Code
		})
	}
	group.Wait()
	if first, second := <-codes, <-codes; first+second != http.StatusOK+http.StatusConflict {
		t.Fatalf("racing for the last place: %d and %d", first, second)
	}
}
