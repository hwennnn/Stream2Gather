package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// catchupCrew is a crew that has watched a video, with Hana there and Mika not.
type catchupCrew struct {
	slug, crewID, sourceID, sessionID string
	roomID                            string
	hana, mika                        func(*http.Request)
}

func newCatchupCrew(t *testing.T, s *Server) catchupCrew {
	t.Helper()
	owner, as := signUp(t, s, "Hana")
	slug, token := newCrew(t, s, as)
	_, mikaAs := signUp(t, s, "Mika")
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, mikaAs); response.Code != http.StatusOK {
		t.Fatalf("join: %d", response.Code)
	}
	record, crewID := crewIDOf(t, s, slug)
	media := seedMedia(t, s, "test", "Marker title")
	sessionID := recapParty(t, s, crewID, "test", media.SourceID, owner.Subject)
	return catchupCrew{slug: slug, crewID: crewID, sourceID: media.SourceID, sessionID: sessionID, roomID: record.ID, hana: as, mika: mikaAs}
}

func (c catchupCrew) momentBody(pos int64, extra string) string {
	return fmt.Sprintf(`{"source":"test","id":"%s","posMs":%d,%s}`, c.sourceID, pos, extra)
}

func TestMomentsAreForMembersAndComeInPositionOrder(t *testing.T) {
	s, _ := stackServer(t)
	crew := newCatchupCrew(t, s)
	_, stranger := signUp(t, s, "Stranger")
	path := "/v1/crews/" + crew.slug + "/moments?source=test&id=" + crew.sourceID

	if response, _ := serve(s, http.MethodGet, path, "", stranger); response.Code != http.StatusForbidden {
		t.Fatalf("stranger: %d", response.Code)
	}

	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+crew.slug+"/moments", crew.momentBody(1, `"emoji":"🔥"`), stranger); response.Code != http.StatusForbidden {
		t.Fatalf("stranger writing: %d", response.Code)
	}

	response, body := serve(s, http.MethodGet, path+"&from=1500&to=2500", "", crew.mika)
	items, _ := body["items"].([]any)
	if response.Code != http.StatusOK || len(items) != 1 || items[0].(map[string]any)["posMs"] != float64(2000) {
		t.Fatalf("range: %d %s", response.Code, response.Body)
	}
}

func TestMomentsPageByPositionWithoutMissingTies(t *testing.T) {
	s, pool := stackServer(t)
	crew := newCatchupCrew(t, s)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO moments (crew_id, source, source_id, pos_ms, kind, author_name, emoji)
		SELECT $1, 'test', $2, (n / 2) * 10, 'reaction', 'x', '🔥' FROM generate_series(1, 1000) AS n`, crew.crewID, crew.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	path := "/v1/crews/" + crew.slug + "/moments?source=test&id=" + crew.sourceID

	seen, after := map[float64]bool{}, ""
	for pages := 0; ; pages++ {
		if pages > 5 {
			t.Fatal("paging never ended")
		}
		response, body := serve(s, http.MethodGet, path+after, "", crew.mika)
		if response.Code != http.StatusOK {
			t.Fatalf("%d %s", response.Code, response.Body)
		}
		for _, item := range body["items"].([]any) {
			seen[item.(map[string]any)["id"].(float64)] = true
		}
		next, more := body["next"].(string)
		if !more {
			break
		}
		after = "&after=" + next
	}

	if len(seen) != 1003 {
		t.Fatalf("%d moments across pages", len(seen))
	}
}

func TestAnItemThatCanNoLongerPlayHasNoMedia(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	crew := newCatchupCrew(t, s)
	var itemID int64
	if err := pool.QueryRow(ctx, `SELECT id FROM session_items WHERE session_id = $1`, crew.sessionID).Scan(&itemID); err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/v1/crews/%s/items/%d", crew.slug, itemID)

	if _, body := serve(s, http.MethodGet, path, "", crew.mika); body["media"] == nil {
		t.Fatalf("playable: %v", body)
	}
	if _, err := pool.Exec(ctx, `UPDATE media SET is_live = true WHERE source_id = $1`, crew.sourceID); err != nil {
		t.Fatal(err)
	}
	if _, body := serve(s, http.MethodGet, path, "", crew.mika); body["media"] != nil {
		t.Fatalf("live: %v", body)
	}
	if response, _ := serve(s, http.MethodGet, fmt.Sprintf("/v1/crews/%s/items/999999999", crew.slug), "", crew.mika); response.Code != http.StatusNotFound {
		t.Fatalf("unknown: %d", response.Code)
	}
}

func TestACatchupMomentIsThereForTheNextPersonAndNotForTheRecap(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	crew := newCatchupCrew(t, s)
	add := "/v1/crews/" + crew.slug + "/moments"

	for _, bad := range []string{
		crew.momentBody(5, `"emoji":"💩"`),
		crew.momentBody(5, `"emoji":"🔥","body":"both"`),
		crew.momentBody(5, `"body":"   "`),
		crew.momentBody(5, `"body":"`+strings.Repeat("x", 501)+`"`),
		crew.momentBody(-1, `"emoji":"🔥"`),
		`{"source":"test","id":"never-watched","posMs":1,"emoji":"🔥"}`,
	} {
		if response, _ := serve(s, http.MethodPost, add, bad, crew.mika); response.Code < 400 {
			t.Fatalf("accepted %s: %d", bad, response.Code)
		}
	}

	if response, _ := serve(s, http.MethodPost, add, crew.momentBody(9000, `"emoji":"😂"`), crew.mika); response.Code != http.StatusCreated {
		t.Fatalf("react: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodPost, add, crew.momentBody(9500, `"body":"caught up"`), crew.mika); response.Code != http.StatusCreated {
		t.Fatalf("chat: %d %s", response.Code, response.Body)
	}

	response, _ := serve(s, http.MethodGet, "/v1/crews/"+crew.slug+"/moments?source=test&id="+crew.sourceID, "", crew.hana)
	for _, want := range []string{`"origin":"catchup"`, `"😂"`, `"body":"caught up"`, `"author":"Mika"`} {
		if !strings.Contains(response.Body.String(), want) {
			t.Fatalf("missing %s in %s", want, response.Body)
		}
	}

	if err := s.DB.BuildRecap(ctx, crew.sessionID); err != nil {
		t.Fatal(err)
	}
	var doc string
	if err := pool.QueryRow(ctx, `SELECT doc::text FROM session_recaps WHERE session_id = $1`, crew.sessionID).Scan(&doc); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(doc, "😂") {
		t.Fatalf("a recap is of the evening itself: %s", doc)
	}

	response, _ = serve(s, http.MethodGet, "/v1/rooms/"+crew.slug+"/messages", "", crew.hana)
	if strings.Contains(response.Body.String(), "caught up") {
		t.Fatalf("catch-up chat reached the room: %s", response.Body)
	}
}

func TestMomentsAreRateLimitedLikeReactions(t *testing.T) {
	s, _ := stackServer(t)
	crew := newCatchupCrew(t, s)
	last := http.StatusCreated
	for i := 0; i <= momentsPerMinute && last == http.StatusCreated; i++ {
		response, _ := serve(s, http.MethodPost, "/v1/crews/"+crew.slug+"/moments", crew.momentBody(int64(i), `"emoji":"🔥"`), crew.mika)
		last = response.Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("last answer: %d", last)
	}
}
