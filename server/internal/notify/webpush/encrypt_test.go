package webpush

import (
	"crypto/ecdh"
	"encoding/base64"
	"strings"
	"testing"
)

func mustDecode(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := decode(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// RFC 8291 Appendix A.
func TestSealMatchesTheRFCExample(t *testing.T) {
	ours, err := ecdh.P256().NewPrivateKey(mustDecode(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	to := Subscription{
		P256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
		// Not a credential: this is the value printed in the RFC.
		Auth: "BTBZMqHH6r4Tts7J_aSIgg", // gitleaks:allow
	}
	got, err := seal([]byte("When I grow up, I want to be a watermelon"), to, ours, mustDecode(t, "DGv6ra1nlYgDCS1FRnbzlw"))
	if err != nil {
		t.Fatal(err)
	}
	want := "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	if encoded := base64.RawURLEncoding.EncodeToString(got); encoded != want {
		t.Fatalf("got %s", encoded)
	}
}

type browser struct {
	key    *ecdh.PrivateKey
	secret []byte
}

func newBrowser(t *testing.T) (browser, Subscription) {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(strings.NewReader(strings.Repeat("seed", 64)))
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte("sixteen byte key")
	encode := base64.RawURLEncoding.EncodeToString
	return browser{key, secret}, Subscription{P256dh: encode(key.PublicKey().Bytes()), Auth: encode(secret)}
}

func TestValidChecksTheKeysABrowserSends(t *testing.T) {
	_, good := newBrowser(t)
	if !good.Valid() {
		t.Fatal("a real browser's keys were refused")
	}
	for _, bad := range []Subscription{{P256dh: "AAAA", Auth: good.Auth}, {P256dh: good.P256dh, Auth: "AAAA"}, {}} {
		if bad.Valid() {
			t.Errorf("%+v accepted", bad)
		}
	}
}

func TestOnlyPushServicesAreAllowed(t *testing.T) {
	cases := []struct {
		endpoint string
		local    bool
		want     bool
	}{
		{"https://fcm.googleapis.com/fcm/send/abc", false, true},
		{"https://web.push.apple.com/abc", false, true},
		{"https://updates.push.services.mozilla.com/wpush/v2/abc", false, true},
		{"https://db5p.notify.windows.com/w/?token=abc", false, true},
		{"http://fcm.googleapis.com/fcm/send/abc", false, false},
		{"https://fcm.googleapis.com.evil.test/abc", false, false},
		{"https://evilpush.apple.com/abc", false, false},
		{"https://fcm.googleapis.com:8443/abc", false, false},
		{"https://user@fcm.googleapis.com/abc", false, false},
		{"http://127.0.0.1:9000/abc", false, false},
		{"http://169.254.169.254/latest", true, false},
		{"http://127.0.0.1:9000/abc", true, true},
		{"http://localhost:9000/abc", true, true},
	}
	for _, c := range cases {
		if got := Allowed(c.endpoint, c.local); got != c.want {
			t.Errorf("%s (local %v): %v", c.endpoint, c.local, got)
		}
	}
}
