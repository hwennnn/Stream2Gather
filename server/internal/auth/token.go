// Package auth issues and checks the signed session a browser holds.
package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrInvalidToken covers every way a token can fail, so callers cannot leak why.
var ErrInvalidToken = errors.New("invalid token")

// Claims identify a session.
type Claims struct {
	Subject string `json:"sub"`
	Name    string `json:"name"`
	Avatar  string `json:"avatar,omitempty"`
	// Account is true once the person has signed in, rather than being a guest.
	Account bool  `json:"acct,omitempty"`
	Expires int64 `json:"exp"`
}

// Issuer signs and verifies session tokens.
type Issuer struct {
	key ed25519.PrivateKey
	now func() time.Time
}

// NewIssuer builds an issuer from a base64 seed. With no seed it keeps a local
// development key on disk, so sessions survive restarts.
func NewIssuer(encodedSeed string) (*Issuer, error) {
	seed, err := loadSeed(encodedSeed)
	if err != nil {
		return nil, err
	}
	return &Issuer{key: ed25519.NewKeyFromSeed(seed), now: time.Now}, nil
}

func loadSeed(encoded string) ([]byte, error) {
	if encoded != "" {
		seed, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("SESSION_KEY must be base64 of %d bytes", ed25519.SeedSize)
		}
		return seed, nil
	}

	path := filepath.Join(".data", "session.key")
	if seed, err := os.ReadFile(path); err == nil && len(seed) == ed25519.SeedSize {
		return seed, nil
	}
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	return seed, os.WriteFile(path, seed, 0o600)
}

// Issue returns a token for claims, valid for ttl.
func (i *Issuer) Issue(claims Claims, ttl time.Duration) (string, error) {
	claims.Expires = i.now().Add(ttl).Unix()
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signature := ed25519.Sign(i.key, payload)
	return encode(payload) + "." + encode(signature), nil
}

// Verify returns the claims of a valid, unexpired token.
func (i *Issuer) Verify(token string) (Claims, error) {
	encodedPayload, encodedSignature, found := strings.Cut(token, ".")
	if !found {
		return Claims{}, ErrInvalidToken
	}
	payload, errPayload := base64.RawURLEncoding.DecodeString(encodedPayload)
	signature, errSignature := base64.RawURLEncoding.DecodeString(encodedSignature)
	if errPayload != nil || errSignature != nil {
		return Claims{}, ErrInvalidToken
	}
	if !ed25519.Verify(i.key.Public().(ed25519.PublicKey), payload, signature) {
		return Claims{}, ErrInvalidToken
	}

	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if i.now().Unix() >= claims.Expires {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}

func encode(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }
