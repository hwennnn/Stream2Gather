package webpush

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/json"
	"math/big"
	"strings"
	"testing"
	"time"
)

func checkJWT(t *testing.T, header, public, audience string) {
	t.Helper()
	fields := strings.Split(strings.TrimPrefix(header, "vapid t="), ", k=")
	if len(fields) != 2 || fields[1] != public {
		t.Fatalf("authorization %q", header)
	}
	parts := strings.Split(fields[0], ".")
	key, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), mustDecode(t, public))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	signature := mustDecode(t, parts[2])
	r, s := new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])
	if !ecdsa.Verify(key, digest[:], r, s) {
		t.Fatal("the signature does not verify")
	}
	var claims struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(mustDecode(t, parts[1]), &claims); err != nil {
		t.Fatal(err)
	}
	life := time.Until(time.Unix(claims.Exp, 0))
	if claims.Aud != audience || claims.Sub == "" || life <= 0 || life > 24*time.Hour {
		t.Fatalf("claims %+v", claims)
	}
}

func TestOneTokenServesAServiceUntilItNearsItsEnd(t *testing.T) {
	public, private, err := GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	keys, err := newVAPID(public, private, "mailto:push@stream2gather.test")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	first, err := keys.header("https://fcm.googleapis.com/a", start)
	if err != nil {
		t.Fatal(err)
	}
	checkJWT(t, first, public, "https://fcm.googleapis.com")
	same, _ := keys.header("https://fcm.googleapis.com/b", start.Add(10*time.Hour))
	if same != first {
		t.Fatal("re-signed within the hour limit")
	}
	apple, _ := keys.header("https://web.push.apple.com/a", start)
	if apple == first {
		t.Fatal("one token crossed two services, whose audiences differ")
	}
	if later, _ := keys.header("https://fcm.googleapis.com/a", start.Add(tokenLife)); later == first {
		t.Fatal("kept a token at its expiry")
	}
}

func TestKeysThatDontMatchAreRefused(t *testing.T) {
	public, private, err := GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	other, _, _ := GenerateKeys()
	if _, err := newVAPID(other, private, "mailto:a@b.test"); err == nil {
		t.Error("mismatched keys accepted")
	}
	if _, err := newVAPID(public, private, ""); err == nil {
		t.Error("no subject accepted")
	}
	if _, err := newVAPID(public, "nonsense", "mailto:a@b.test"); err == nil {
		t.Error("bad private key accepted")
	}
}
