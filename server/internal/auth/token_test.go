package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

func issuer(t *testing.T, seedByte byte) *Issuer {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = seedByte
	i, err := NewIssuer(base64.StdEncoding.EncodeToString(seed))
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestRoundTrip(t *testing.T) {
	i := issuer(t, 1)
	token, err := i.Issue("g_1", "Sam", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := i.Verify(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "g_1" || claims.Name != "Sam" {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestRejectsBadTokens(t *testing.T) {
	i := issuer(t, 1)
	token, _ := i.Issue("g_1", "Sam", time.Hour)
	foreign, _ := issuer(t, 2).Issue("g_1", "Sam", time.Hour)
	expired, _ := i.Issue("g_1", "Sam", -time.Second)
	payload, signature, _ := strings.Cut(token, ".")
	otherPayload, _, _ := strings.Cut(foreign, ".")

	for name, value := range map[string]string{
		"empty":          "",
		"no signature":   payload,
		"garbage":        "a.b",
		"wrong key":      foreign,
		"expired":        expired,
		"swapped claims": otherPayload + "x." + signature,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := i.Verify(value); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("err = %v", err)
			}
		})
	}
}
