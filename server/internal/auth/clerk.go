package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwks"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
	"github.com/clerk/clerk-sdk-go/v2/user"

	"stream2gather/internal/room"
)

// keyTTL bounds how long a signing key Clerk has retired stays trusted.
const keyTTL = time.Hour

// Identity is the person behind a verified Clerk session.
type Identity struct {
	ClerkID   string
	Name      string
	AvatarURL string
}

// Clerk verifies session tokens against one Clerk application.
type Clerk struct {
	keys   *jwks.Client
	users  *user.Client
	origin string

	now func() time.Time

	mu    sync.Mutex
	cache map[string]cachedKey
}

type cachedKey struct {
	key     *clerk.JSONWebKey
	fetched time.Time
}

// NewClerk builds a verifier that accepts tokens issued to origin.
func NewClerk(secretKey, origin string) *Clerk {
	return newClerk(&clerk.ClientConfig{BackendConfig: clerk.BackendConfig{Key: clerk.String(secretKey)}}, origin)
}

func newClerk(config *clerk.ClientConfig, origin string) *Clerk {
	return &Clerk{
		keys:   jwks.NewClient(config),
		users:  user.NewClient(config),
		origin: origin,
		now:    time.Now,
		cache:  map[string]cachedKey{},
	}
}

// Verify returns the identity for a valid token, or ErrInvalidToken.
func (c *Clerk) Verify(ctx context.Context, token string) (Identity, error) {
	unverified, err := jwt.Decode(ctx, &jwt.DecodeParams{Token: token})
	if err != nil {
		return Identity{}, ErrInvalidToken
	}
	key, err := c.key(ctx, unverified.KeyID)
	if err != nil {
		return Identity{}, ErrInvalidToken
	}
	claims, err := jwt.Verify(ctx, &jwt.VerifyParams{
		Token:                  token,
		JWK:                    key,
		AuthorizedPartyHandler: func(party string) bool { return party == c.origin },
	})
	if err != nil {
		return Identity{}, ErrInvalidToken
	}

	profile, err := c.users.Get(ctx, claims.Subject)
	if err != nil {
		return Identity{}, fmt.Errorf("load clerk user: %w", err)
	}
	identity := Identity{ClerkID: profile.ID, Name: displayName(profile)}
	if profile.HasImage && profile.ImageURL != nil {
		identity.AvatarURL = *profile.ImageURL
	}
	return identity, nil
}

func (c *Clerk) key(ctx context.Context, id string) (*clerk.JSONWebKey, error) {
	c.mu.Lock()
	cached, found := c.cache[id]
	c.mu.Unlock()
	if found && c.now().Sub(cached.fetched) < keyTTL {
		return cached.key, nil
	}

	key, err := jwt.GetJSONWebKey(ctx, &jwt.GetJSONWebKeyParams{KeyID: id, JWKSClient: c.keys})
	if err != nil {
		return nil, err
	}
	if key == nil {
		return nil, errors.New("unknown signing key")
	}
	c.mu.Lock()
	c.cache[id] = cachedKey{key: key, fetched: c.now()}
	c.mu.Unlock()
	return key, nil
}

// displayName never falls back to an email address, because everyone in a room
// sees it.
func displayName(profile *clerk.User) string {
	var parts []string
	for _, part := range []*string{profile.FirstName, profile.LastName} {
		if part != nil && strings.TrimSpace(*part) != "" {
			parts = append(parts, strings.TrimSpace(*part))
		}
	}
	name := strings.Join(parts, " ")
	if name == "" && profile.Username != nil {
		name = strings.TrimSpace(*profile.Username)
	}
	return truncate(name, room.MaxNameRunes)
}

func truncate(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

var clerkHostPattern = regexp.MustCompile(`^[a-z0-9-]+(\.[a-z0-9-]+)+$`)

// ClerkHost returns the sign-in host encoded in a publishable key, or "" if the
// key is empty or malformed.
func ClerkHost(publishableKey string) string {
	encoded := strings.TrimPrefix(strings.TrimPrefix(publishableKey, "pk_test_"), "pk_live_")
	if encoded == publishableKey {
		return ""
	}
	decoded, err := base64.RawStdEncoding.DecodeString(strings.TrimRight(encoded, "="))
	if err != nil {
		return ""
	}
	host := strings.TrimSuffix(string(decoded), "$")
	if !clerkHostPattern.MatchString(host) {
		return ""
	}
	return host
}
