package auth

import (
	"encoding/base64"
	"testing"

	"github.com/clerk/clerk-sdk-go/v2"

	"stream2gather/internal/room"
)

func TestClerkHost(t *testing.T) {
	encode := func(value string) string { return base64.StdEncoding.EncodeToString([]byte(value)) }
	cases := map[string]string{
		"":                                       "",
		"not-a-key":                              "",
		"pk_test_%%%":                            "",
		"pk_test_" + encode("x.accounts.dev$"):   "x.accounts.dev",
		"pk_live_" + encode("clerk.example.io$"): "clerk.example.io",
		"pk_test_" + encode("bad host; script-src *$"): "",
	}
	for key, want := range cases {
		if got := ClerkHost(key); got != want {
			t.Errorf("ClerkHost(%q) = %q, want %q", key, got, want)
		}
	}
}

func TestDisplayNameNeverUsesEmail(t *testing.T) {
	first, last, username, blank := "Ada", "Lovelace", "ada99", "  "
	cases := []struct {
		profile clerk.User
		want    string
	}{
		{clerk.User{FirstName: &first, LastName: &last}, "Ada Lovelace"},
		{clerk.User{FirstName: &first, LastName: &blank}, "Ada"},
		{clerk.User{FirstName: &blank, Username: &username}, "ada99"},
		{clerk.User{}, ""},
	}
	for _, test := range cases {
		if got := displayName(&test.profile); got != test.want {
			t.Errorf("displayName = %q, want %q", got, test.want)
		}
	}
}

func TestLongNamesAreCutOnRunes(t *testing.T) {
	long := ""
	for range 40 {
		long += "界"
	}
	if got := []rune(displayName(&clerk.User{FirstName: &long})); len(got) != room.MaxNameRunes {
		t.Fatalf("got %d runes", len(got))
	}
}
