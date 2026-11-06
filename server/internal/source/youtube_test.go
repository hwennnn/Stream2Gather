package source

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestYouTubeMatch(t *testing.T) {
	const id = "dQw4w9WgXcQ"
	y := NewYouTube("", "")
	links := []string{
		"https://www.youtube.com/watch?v=" + id,
		"https://youtube.com/watch?v=" + id + "&t=30s",
		"https://m.youtube.com/watch?v=" + id,
		"https://music.youtube.com/watch?v=" + id,
		"https://youtu.be/" + id + "?si=abc",
		"https://www.youtube.com/shorts/" + id,
		"https://www.youtube.com/embed/" + id,
		"https://www.youtube.com/live/" + id,
		"https://www.youtube-nocookie.com/embed/" + id,
	}
	for _, link := range links {
		parsed, _ := url.Parse(link)
		ref, ok := y.Match(parsed)
		if !ok || ref.ID != id {
			t.Errorf("%s: ref = %+v, ok = %v", link, ref, ok)
		}
	}

	rejected := []string{
		"https://www.youtube.com/watch?v=short",
		"https://www.youtube.com/channel/UC123",
		"https://vimeo.com/" + id,
		"https://evil.example/watch?v=" + id,
		"https://youtube.com.evil.example/watch?v=" + id,
	}
	for _, link := range rejected {
		parsed, _ := url.Parse(link)
		if ref, ok := y.Match(parsed); ok {
			t.Errorf("%s matched: %+v", link, ref)
		}
	}
}

func TestParseDuration(t *testing.T) {
	tests := map[string]int64{
		"PT3M33S":   213_000,
		"PT1H":      3_600_000,
		"P1DT2H":    93_600_000,
		"PT45S":     45_000,
		"P0D":       0,
		"not-valid": 0,
	}
	for value, want := range tests {
		if got := parseDuration(value); got != want {
			t.Errorf("%s = %d, want %d", value, got, want)
		}
	}
}

func TestResolveSendsKeyInHeaderOnly(t *testing.T) {
	var header, query string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header, query = r.Header.Get("x-goog-api-key"), r.URL.RawQuery
		_, _ = w.Write([]byte(`{"items":[{"id":"dQw4w9WgXcQ",
			"snippet":{"title":"A &amp; B","channelTitle":"C","thumbnails":{"high":{"url":"t"}}},
			"contentDetails":{"duration":"PT10S"},
			"status":{"embeddable":true,"privacyStatus":"public"}}]}`))
	}))
	defer server.Close()

	media, err := NewYouTube("secret", server.URL).Resolve(context.Background(), Ref{ID: "dQw4w9WgXcQ"})
	if err != nil {
		t.Fatal(err)
	}
	if header != "secret" || strings.Contains(query, "secret") {
		t.Fatalf("header = %q, query = %q", header, query)
	}
	if media.Title != "A & B" || media.DurationMS != 10_000 || media.ThumbnailURL != "t" {
		t.Fatalf("media = %+v", media)
	}
}

func TestResolveRejectsWhatCannotBeEmbedded(t *testing.T) {
	tests := map[string]string{
		"missing":        `{"items":[]}`,
		"not embeddable": `{"items":[{"id":"x","status":{"embeddable":false,"privacyStatus":"public"}}]}`,
		"private":        `{"items":[{"id":"x","status":{"embeddable":true,"privacyStatus":"private"}}]}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			_, err := NewYouTube("k", server.URL).Resolve(context.Background(), Ref{ID: "x"})
			if !errors.Is(err, ErrUnavailable) || !IsUserError(err) {
				t.Fatalf("err = %v", err)
			}
			if got, want := err.Error(), "This video can’t be played here. Try another."; got != want {
				t.Fatalf("copy = %q, want the sentence viewers see", got)
			}
		})
	}
}

func TestQuotaErrorIsRecognised(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"errors":[{"reason":"quotaExceeded"}]}}`))
	}))
	defer server.Close()
	_, err := NewYouTube("k", server.URL).Search(context.Background(), "q", "")
	if !errors.Is(err, ErrOverBudget) {
		t.Fatalf("err = %v", err)
	}
}

func TestLiveAndUpcomingStreamsAreRejected(t *testing.T) {
	for _, state := range []string{"live", "upcoming"} {
		t.Run(state, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"items":[{"id":"x","snippet":{"liveBroadcastContent":"` + state + `"},
					"status":{"embeddable":true,"privacyStatus":"public"}}]}`))
			}))
			defer server.Close()
			_, err := NewYouTube("k", server.URL).Resolve(context.Background(), Ref{ID: "x"})
			if !errors.Is(err, ErrLive) || !IsUserError(err) || err.Error() != "Live streams aren’t supported yet." {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestDirectLinksNeedHTTPSOutsideDev(t *testing.T) {
	tests := []struct {
		link   string
		direct Direct
		want   bool
	}{
		{"https://cdn.test/a.mp4", Direct{HTTPSOnly: true}, true},
		{"http://127.0.0.1:18082/a.mp4", Direct{HTTPSOnly: true}, false},
		{"http://cdn.test/a.mp4", Direct{HTTPSOnly: true}, false},
		{"http://127.0.0.1:18082/a.mp4", Direct{}, true},
		{"http://cdn.test/a.mp4", Direct{}, false},
		{"ftp://127.0.0.1/a.mp4", Direct{}, false},
	}
	for _, test := range tests {
		link, err := url.Parse(test.link)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := test.direct.Match(link); ok != test.want {
			t.Errorf("%+v %s = %v", test.direct, test.link, ok)
		}
	}
}
