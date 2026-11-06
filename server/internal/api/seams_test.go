package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stream2gather/internal/config"
	"stream2gather/internal/source"
)

func TestContentPolicyOnlyOpensWhatIsOn(t *testing.T) {
	off := contentPolicy(policy{})
	for _, host := range []string{"vimeo", "twitch"} {
		if strings.Contains(off, host) {
			t.Errorf("%s allowed while off: %s", host, off)
		}
	}
	on := contentPolicy(policy{Voice: []string{"wss://lk.test", "https://lk.test"}, Vimeo: true, Twitch: true})
	for _, want := range []string{
		"connect-src 'self' wss://lk.test https://lk.test",
		"script-src 'self' https://www.youtube.com https://s.ytimg.com https://player.twitch.tv",
		"frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://player.twitch.tv",
		"img-src 'self' https://i.ytimg.com data: https://i.vimeocdn.com",
	} {
		if !strings.Contains(on, want) {
			t.Errorf("policy missing %q: %s", want, on)
		}
	}
}

func TestConfigAdvertisesFeatures(t *testing.T) {
	s := &Server{
		Catalog:        source.NewCatalog(nil, 0, nil),
		Voice:          config.LiveKit{URL: "wss://lk.test", APIKey: "k", APISecret: strings.Repeat("s", 32)},
		VAPIDPublicKey: "public",
		TwitchParent:   "localhost",
	}
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/config", nil))

	var got struct {
		Voice          bool   `json:"voice"`
		VAPIDPublicKey string `json:"vapidPublicKey"`
		TwitchParent   string `json:"twitchParent"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Voice || got.VAPIDPublicKey != "public" || got.TwitchParent != "localhost" {
		t.Fatalf("got %+v", got)
	}
	if header := response.Header().Get("Permissions-Policy"); header != "microphone=(self)" {
		t.Fatalf("permissions policy = %q", header)
	}
}

func TestDeepLinksReachTheApp(t *testing.T) {
	s := staticServer(t)
	for _, path := range []string{"/r/abc/catchup/12", "/s/token"} {
		response := httptest.NewRecorder()
		s.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if !strings.Contains(response.Body.String(), "app") {
			t.Errorf("%s: %d %q", path, response.Code, response.Body.String())
		}
	}
}
