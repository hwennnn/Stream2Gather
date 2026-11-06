package source

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
)

func TestVimeoMatch(t *testing.T) {
	v := NewVimeo("")
	links := []struct{ link, id, canonical string }{
		{"https://vimeo.com/76979871", "76979871", "https://vimeo.com/76979871"},
		{"https://www.vimeo.com/76979871/", "76979871", "https://vimeo.com/76979871"},
		{"https://vimeo.com/76979871?share=copy", "76979871", "https://vimeo.com/76979871"},
		{"https://vimeo.com/channels/staffpicks/76979871", "76979871", "https://vimeo.com/76979871"},
		{"https://vimeo.com/groups/shortfilms/videos/76979871", "76979871", "https://vimeo.com/76979871"},
		{"https://vimeo.com/showcase/1234/video/76979871", "76979871", "https://vimeo.com/76979871"},
		{"https://vimeo.com/album/1234/video/76979871", "76979871", "https://vimeo.com/76979871"},
		{"https://player.vimeo.com/video/76979871", "76979871", "https://vimeo.com/76979871"},
		{"https://vimeo.com/76979871/da39a3ee5e", "76979871:da39a3ee5e", "https://vimeo.com/76979871/da39a3ee5e"},
		{"https://vimeo.com/76979871?h=da39a3ee5e", "76979871:da39a3ee5e", "https://vimeo.com/76979871/da39a3ee5e"},
		{"https://player.vimeo.com/video/76979871?h=da39a3ee5e&title=0", "76979871:da39a3ee5e", "https://vimeo.com/76979871/da39a3ee5e"},
	}
	for _, c := range links {
		parsed, _ := url.Parse(c.link)
		ref, ok := v.Match(parsed)
		if !ok || ref.ID != c.id || ref.URL != c.canonical {
			t.Errorf("%s: ref = %+v, ok = %v", c.link, ref, ok)
		}
	}

	rejected := []string{
		"https://vimeo.com/",
		"https://vimeo.com/staff",
		"https://vimeo.com/channels/staffpicks",
		"https://vimeo.com/76979871/not-a-hash",
		"https://vimeo.com/76979871?h=../../evil",
		"https://vimeo.com/event/76979871",
		"https://vimeo.com.evil.example/76979871",
		"https://evil.example/76979871",
	}
	for _, link := range rejected {
		parsed, _ := url.Parse(link)
		if ref, ok := v.Match(parsed); ok {
			t.Errorf("%s matched: %+v", link, ref)
		}
	}
}

func TestVimeoResolve(t *testing.T) {
	recorded, err := os.ReadFile("testdata/vimeo_oembed.json")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{name: "public video", status: http.StatusOK, body: string(recorded)},
		{name: "not found", status: http.StatusNotFound, want: ErrNoEmbed},
		{name: "private", status: http.StatusForbidden, want: ErrNoEmbed},
		{name: "kept to other domains", status: http.StatusOK, body: `{"domain_status_code":403}`, want: ErrNoEmbed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var asked string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				asked = r.URL.Query().Get("url")
				w.WriteHeader(c.status)
				_, _ = w.Write([]byte(c.body))
			}))
			defer server.Close()

			ref := Ref{Source: vimeoName, ID: "76979871:da39a3ee5e", URL: "https://vimeo.com/76979871/da39a3ee5e"}
			media, err := NewVimeo(server.URL).Resolve(context.Background(), ref)
			if !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			if asked != ref.URL {
				t.Errorf("asked about %q", asked)
			}
			if c.want != nil {
				return
			}
			if media.SourceID != ref.ID || media.Author != "Vimeo" || media.DurationMS != 62000 || media.IsLive {
				t.Errorf("media = %+v", media)
			}
			if media.Title == "" || media.ThumbnailURL == "" {
				t.Errorf("media = %+v", media)
			}
		})
	}
}

// A Vimeo outage must not read as "this video can't be embedded".
func TestVimeoResolveOutage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	_, err := NewVimeo(server.URL).Resolve(context.Background(), Ref{URL: "https://vimeo.com/76979871"})
	if err == nil || IsUserError(err) {
		t.Fatalf("err = %v", err)
	}
}
