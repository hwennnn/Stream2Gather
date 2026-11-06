package webpush

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sync"
	"time"
)

const (
	// Services accept up to 24 hours. Renewing an hour early keeps a token in
	// flight valid, and well inside Apple's limit of one refresh an hour.
	tokenLife   = 12 * time.Hour
	renewBefore = time.Hour
)

type token struct {
	value   string
	expires time.Time
}

// vapid proves to push services that one server sends these messages.
type vapid struct {
	key     *ecdsa.PrivateKey
	public  string
	subject string

	mu     sync.Mutex
	tokens map[string]token
}

func newVAPID(publicKey, privateKey, subject string) (*vapid, error) {
	if subject == "" {
		return nil, errors.New("VAPID_SUBJECT is required")
	}
	raw, err := decode(privateKey)
	if err != nil {
		return nil, errors.New("VAPID_PRIVATE_KEY is not base64url")
	}
	key, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), raw)
	if err != nil {
		return nil, errors.New("VAPID_PRIVATE_KEY is not a P-256 key")
	}
	derived, err := key.PublicKey.Bytes()
	if err != nil {
		return nil, err
	}
	stated, err := decode(publicKey)
	if err != nil || !bytes.Equal(stated, derived) {
		return nil, errors.New("VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY")
	}
	return &vapid{key: key, public: base64.RawURLEncoding.EncodeToString(derived), subject: subject, tokens: map[string]token{}}, nil
}

// header is the Authorization value for this endpoint. Tokens are per push
// service, and reused until they near their end.
func (v *vapid) header(endpoint string, now time.Time) (string, error) {
	address, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	audience := address.Scheme + "://" + address.Host

	v.mu.Lock()
	defer v.mu.Unlock()
	current, ok := v.tokens[audience]
	if !ok || now.After(current.expires.Add(-renewBefore)) {
		expires := now.Add(tokenLife)
		value, err := v.sign(audience, expires)
		if err != nil {
			return "", err
		}
		current = token{value, expires}
		v.tokens[audience] = current
	}
	return fmt.Sprintf("vapid t=%s, k=%s", current.value, v.public), nil
}

func (v *vapid) sign(audience string, expires time.Time) (string, error) {
	claims, err := json.Marshal(map[string]any{"aud": audience, "exp": expires.Unix(), "sub": v.subject})
	if err != nil {
		return "", err
	}
	encode := base64.RawURLEncoding.EncodeToString
	signed := encode([]byte(`{"typ":"JWT","alg":"ES256"}`)) + "." + encode(claims)
	digest := sha256.Sum256([]byte(signed))
	r, s, err := ecdsa.Sign(rand.Reader, v.key, digest[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	s.FillBytes(signature[32:])
	return signed + "." + encode(signature), nil
}

// GenerateKeys makes a VAPID pair in the form New reads.
func GenerateKeys() (publicKey, privateKey string, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	public, err := key.PublicKey.Bytes()
	if err != nil {
		return "", "", err
	}
	private, err := key.Bytes()
	if err != nil {
		return "", "", err
	}
	encode := base64.RawURLEncoding.EncodeToString
	return encode(public), encode(private), nil
}
