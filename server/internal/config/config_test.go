package config

import (
	"slices"
	"strings"
	"testing"
)

func TestLiveKitNeedsAllThreeValues(t *testing.T) {
	secret := strings.Repeat("s", minLiveKitSecret)
	cases := []struct {
		name string
		kit  LiveKit
		want bool
	}{
		{"unset", LiveKit{}, false},
		{"no key", LiveKit{URL: "wss://lk.test", APISecret: secret}, false},
		{"short secret", LiveKit{URL: "wss://lk.test", APIKey: "k", APISecret: secret[1:]}, false},
		{"complete", LiveKit{URL: "wss://lk.test", APIKey: "k", APISecret: secret}, true},
	}
	for _, c := range cases {
		if got := c.kit.Enabled(); got != c.want {
			t.Errorf("%s: enabled = %v", c.name, got)
		}
	}
}

func TestLiveKitOrigins(t *testing.T) {
	secret := strings.Repeat("s", minLiveKitSecret)
	if got := (LiveKit{URL: "wss://lk.test"}).Origins(); got != nil {
		t.Fatalf("an unusable server is allowed: %v", got)
	}
	cases := map[string][]string{
		"wss://lk.test":        {"wss://lk.test", "https://lk.test"},
		"ws://127.0.0.1:17880": {"ws://127.0.0.1:17880", "http://127.0.0.1:17880"},
	}
	for url, want := range cases {
		if got := (LiveKit{URL: url, APIKey: "k", APISecret: secret}).Origins(); !slices.Equal(got, want) {
			t.Errorf("%s: got %v", url, got)
		}
	}
}

// YouTube refuses many videos on a page whose address is an IP, with the same
// error 150 an owner's own block gives, so a local server must use a name.
func TestNamedOriginReplacesLoopbackIPs(t *testing.T) {
	cases := map[string]string{
		"http://127.0.0.1:18099":  "http://localhost:18099",
		"http://[::1]:5273":       "http://localhost:5273",
		"http://127.0.0.1":        "http://localhost",
		"http://localhost:18099":  "http://localhost:18099",
		"https://example.com":     "https://example.com",
		"http://192.168.1.20:80":  "http://192.168.1.20:80",
		"not a url at all % here": "not a url at all % here",
	}
	for origin, want := range cases {
		if got := namedOrigin(origin); got != want {
			t.Errorf("%s: got %s", origin, got)
		}
	}
}

func TestIPOrigin(t *testing.T) {
	cases := map[string]bool{
		"http://192.168.1.20:18080": true,
		"http://[2001:db8::1]:80":   true,
		"http://localhost:18080":    false,
		"https://example.com":       false,
	}
	for origin, want := range cases {
		if got := IPOrigin(origin); got != want {
			t.Errorf("%s: got %v", origin, got)
		}
	}
}
