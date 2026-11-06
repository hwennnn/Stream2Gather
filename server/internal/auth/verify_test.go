package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/go-jose/go-jose/v4"
	josejwt "github.com/go-jose/go-jose/v4/jwt"
)

const origin = "https://app.test"

type world struct {
	key     *rsa.PrivateKey
	kid     string
	served  []map[string]string
	clerk   *Clerk
	jwksHit int
	// sessions holds each session's status. Clerk answers 404 for any other.
	sessions map[string]string
	broken   bool
	// stuck is a session Clerk lists but won't revoke.
	stuck string
}

func jwk(k *rsa.PublicKey, kid string) map[string]string {
	enc := base64.RawURLEncoding.EncodeToString
	return map[string]string{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid, "n": enc(k.N.Bytes()), "e": enc(big.NewInt(int64(k.E)).Bytes())}
}

func newWorld(t *testing.T) *world {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	w := &world{key: key, kid: "ins_1", sessions: map[string]string{"sess_1": sessionActive}}
	w.served = []map[string]string{jwk(&key.PublicKey, w.kid)}
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/jwks") {
			w.jwksHit++
			_ = json.NewEncoder(rw).Encode(map[string]any{"keys": w.served})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/sessions") {
			w.serveSessions(rw, r)
			return
		}
		_ = json.NewEncoder(rw).Encode(map[string]any{"id": strings.TrimPrefix(r.URL.Path, "/users/"), "object": "user", "first_name": "Ada"})
	}))
	t.Cleanup(server.Close)
	config := &clerk.ClientConfig{BackendConfig: clerk.BackendConfig{Key: clerk.String("sk_test"), URL: clerk.String(server.URL)}}
	w.clerk = newClerk(config, origin)
	return w
}

func (w *world) serveSessions(rw http.ResponseWriter, r *http.Request) {
	if w.broken {
		rw.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(rw).Encode(map[string]any{"errors": []any{}})
		return
	}
	if r.URL.Path == "/sessions" {
		listed := []map[string]string{}
		for id, status := range w.sessions {
			if status == r.URL.Query().Get("status") && r.URL.Query().Get("user_id") == "user_1" {
				listed = append(listed, map[string]string{"id": id, "status": status})
			}
		}
		sort.Slice(listed, func(i, j int) bool { return listed[i]["id"] < listed[j]["id"] })
		_ = json.NewEncoder(rw).Encode(map[string]any{"data": listed, "total_count": len(listed)})
		return
	}
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/sessions/"), "/revoke")
	status, found := w.sessions[id]
	if !found {
		rw.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(rw).Encode(map[string]any{"errors": []any{map[string]string{"code": "resource_not_found"}}})
		return
	}
	if strings.HasSuffix(r.URL.Path, "/revoke") {
		if id == w.stuck {
			rw.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(rw).Encode(map[string]any{"errors": []any{}})
			return
		}
		status = "revoked"
		w.sessions[id] = status
	}
	_ = json.NewEncoder(rw).Encode(map[string]string{"id": id, "status": status})
}

func sign(t *testing.T, key any, alg jose.SignatureAlgorithm, kid string, claims map[string]any) string {
	t.Helper()
	opts := (&jose.SignerOptions{}).WithHeader("kid", kid).WithType("JWT")
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: alg, Key: key}, opts)
	if err != nil {
		t.Fatal(err)
	}
	token, err := josejwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func good() map[string]any {
	now := time.Now()
	return map[string]any{"iss": "https://x.clerk.accounts.dev", "sub": "user_1", "azp": origin, "sid": "sess_1",
		"iat": now.Unix(), "nbf": now.Add(-time.Second).Unix(), "exp": now.Add(time.Minute).Unix()}
}

func with(key string, value any) map[string]any { c := good(); c[key] = value; return c }

func TestVerifyRules(t *testing.T) {
	w := newWorld(t)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	noAzp := good()
	delete(noAzp, "azp")
	hmacKey := w.key.PublicKey.N.Bytes() // Public material used as a shared secret.
	cases := []struct {
		name  string
		token string
		ok    bool
	}{
		{"good", sign(t, w.key, jose.RS256, w.kid, good()), true},
		{"other origin", sign(t, w.key, jose.RS256, w.kid, with("azp", "https://evil.test")), false},
		{"no azp", sign(t, w.key, jose.RS256, w.kid, noAzp), false},
		{"expired", sign(t, w.key, jose.RS256, w.kid, with("exp", time.Now().Add(-time.Minute).Unix())), false},
		{"future nbf", sign(t, w.key, jose.RS256, w.kid, with("nbf", time.Now().Add(time.Hour).Unix())), false},
		{"wrong issuer", sign(t, w.key, jose.RS256, w.kid, with("iss", "https://evil.test")), false},
		{"forged key, known kid", sign(t, other, jose.RS256, w.kid, good()), false},
		{"unknown kid", sign(t, other, jose.RS256, "nope", good()), false},
		{"hs256 confusion", sign(t, hmacKey, jose.HS256, w.kid, good()), false},
	}
	for _, c := range cases {
		identity, err := w.clerk.Verify(context.Background(), c.token)
		t.Logf("%-24s err=%v id=%q", c.name, err, identity.ClerkID)
		if c.ok != (err == nil) {
			t.Errorf("%s: err = %v", c.name, err)
		}
		if err != nil && !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: not ErrInvalidToken: %v", c.name, err)
		}
	}
}

// Clerk retires a key. A token signed with it must stop working.
func TestRetiredKeyIsNotTrustedForever(t *testing.T) {
	w := newWorld(t)
	now := time.Now()
	w.clerk.now = func() time.Time { return now }
	token := func() string { return sign(t, w.key, jose.RS256, w.kid, good()) }
	if _, err := w.clerk.Verify(context.Background(), token()); err != nil {
		t.Fatal(err)
	}

	next, _ := rsa.GenerateKey(rand.Reader, 2048)
	w.served = []map[string]string{jwk(&next.PublicKey, "ins_2")}
	now = now.Add(keyTTL - time.Minute)
	if _, err := w.clerk.Verify(context.Background(), token()); err != nil {
		t.Fatalf("inside the TTL: %v", err)
	}
	if w.jwksHit != 1 {
		t.Fatalf("%d JWKS fetches, want the key cached", w.jwksHit)
	}

	now = now.Add(2 * time.Minute)
	if _, err := w.clerk.Verify(context.Background(), token()); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("a key no longer in the JWKS still verifies: %v", err)
	}
}

func TestEndSessionsReachesEveryDeviceOfThatPersonOnly(t *testing.T) {
	w := newWorld(t)
	w.sessions["sess_2"] = sessionActive
	if err := w.clerk.EndSessions(context.Background(), "user_1"); err != nil {
		t.Fatal(err)
	}
	if w.sessions["sess_1"] != "revoked" || w.sessions["sess_2"] != "revoked" {
		t.Fatalf("sessions = %v", w.sessions)
	}

	w.sessions["sess_3"] = sessionActive
	if err := w.clerk.EndSessions(context.Background(), "user_other"); err != nil {
		t.Fatal(err)
	}
	if w.sessions["sess_3"] != sessionActive {
		t.Fatalf("someone else's session ended: %v", w.sessions)
	}
}

func TestOneStuckSessionNeitherHidesNorBlocksTheRest(t *testing.T) {
	w := newWorld(t)
	w.sessions["sess_0"] = sessionActive // Listed first, so giving up here would spare sess_1.
	w.stuck = "sess_0"
	if err := w.clerk.EndSessions(context.Background(), "user_1"); err == nil {
		t.Fatal("a device stayed signed in and nobody heard")
	}
	if w.sessions["sess_1"] != "revoked" {
		t.Fatalf("the failure stopped the others: %v", w.sessions)
	}
}

// A token signed before the sign-out still has a good signature for its last minute.
func TestATokenDiesWithItsSession(t *testing.T) {
	w := newWorld(t)
	token := sign(t, w.key, jose.RS256, w.kid, good())
	if _, err := w.clerk.Verify(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	if err := w.clerk.EndSessions(context.Background(), "user_1"); err != nil {
		t.Fatal(err)
	}
	if _, err := w.clerk.Verify(context.Background(), token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("a token outlived its session: %v", err)
	}

	delete(w.sessions, "sess_1")
	if _, err := w.clerk.Verify(context.Background(), token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("a session Clerk has forgotten: %v", err)
	}
}

// An outage says nothing about the person, so it mustn't look like a bad token.
func TestAClerkOutageIsNotABadToken(t *testing.T) {
	w := newWorld(t)
	w.broken = true
	_, err := w.clerk.Verify(context.Background(), sign(t, w.key, jose.RS256, w.kid, good()))
	if err == nil || errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Verify = %v", err)
	}
	if err := w.clerk.EndSessions(context.Background(), "user_1"); err == nil {
		t.Fatal("EndSessions hid an outage")
	}
}
