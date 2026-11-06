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
