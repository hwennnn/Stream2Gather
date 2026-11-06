package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stream2gather/internal/room"
)

func TestRoomCardSaysWhatIsPlaying(t *testing.T) {
	card := roomCard("Friday night", &room.Media{Title: "Sintel", ThumbnailURL: "https://i.ytimg.com/vi/x/hq.jpg"})
	want := linkCard{Title: "Friday night", Description: "Watching Sintel. Saved you a seat.", Image: "https://i.ytimg.com/vi/x/hq.jpg"}
	if card != want {
		t.Fatalf("card = %+v", card)
	}
}

func TestAnEmptyRoomUnfurlsToTheDefaultCard(t *testing.T) {
	tags := roomCard(`Mia's "room"`, nil).tags("https://s2g.example/")

	for _, want := range []string{
		`property="og:image" content="https://s2g.example/og.png"`,
		`property="og:description" content="Saved you a seat."`,
		`content="Mia&#39;s &#34;room&#34;"`,
		`name="twitter:card" content="summary_large_image"`,
	} {
		if !strings.Contains(tags, want) {
			t.Fatalf("missing %s in %s", want, tags)
		}
	}
}

func TestTheLandingUnfurlsAndOtherPathsStayStatic(t *testing.T) {
	s := staticServer(t)
	s.PublicOrigin = "https://s2g.example"
	if err := os.WriteFile(filepath.Join(s.WebDir, "index.html"), []byte("<html><head></head></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := s.Handler()

	landing := httptest.NewRecorder()
	handler.ServeHTTP(landing, httptest.NewRequest(http.MethodGet, "/", nil))
	if body := landing.Body.String(); !strings.Contains(body, `content="https://s2g.example/og.png"`) {
		t.Fatalf("landing = %d %s", landing.Code, body)
	}

	asset := httptest.NewRecorder()
	handler.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, "/sample.mp4", nil))
	if asset.Body.String() != "video" {
		t.Fatalf("asset = %d %s", asset.Code, asset.Body.String())
	}
}
