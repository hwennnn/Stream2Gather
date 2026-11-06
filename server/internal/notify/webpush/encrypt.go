// Package webpush sends one encrypted message to one browser. It uses only the
// standard library, because webpush-go signs a new VAPID token for every send and
// Apple asks for at most one refresh an hour. serve imports this for Allowed, so it
// must stay free of Temporal.
package webpush

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
)

const (
	saltSize   = 16
	authSize   = 16
	recordSize = 4096
	// lastRecord ends the one and only record (RFC 8188).
	lastRecord = 0x02
)

// Subscription is one browser's address and keys, as PushSubscription gives them.
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

func decode(value string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(trimPadding(value))
}

// Browsers send these unpadded, but the spec lets a client pad them.
func trimPadding(value string) string {
	for len(value) > 0 && value[len(value)-1] == '=' {
		value = value[:len(value)-1]
	}
	return value
}

// Valid reports whether these keys can be encrypted to.
func (s Subscription) Valid() bool {
	key, err := decode(s.P256dh)
	if err != nil {
		return false
	}
	if _, err := ecdh.P256().NewPublicKey(key); err != nil {
		return false
	}
	secret, err := decode(s.Auth)
	return err == nil && len(secret) == authSize
}

func encrypt(plain []byte, to Subscription) ([]byte, error) {
	ours, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return seal(plain, to, ours, salt)
}

// seal is RFC 8291 with its random inputs passed in, so the RFC's example can be
// checked byte for byte.
func seal(plain []byte, to Subscription, ours *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	theirBytes, err := decode(to.P256dh)
	if err != nil {
		return nil, err
	}
	theirs, err := ecdh.P256().NewPublicKey(theirBytes)
	if err != nil {
		return nil, err
	}
	secret, err := decode(to.Auth)
	if err != nil {
		return nil, err
	}
	if len(secret) != authSize {
		return nil, errors.New("auth secret is the wrong size")
	}
	shared, err := ours.ECDH(theirs)
	if err != nil {
		return nil, err
	}

	ourBytes := ours.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), theirBytes...), ourBytes...)
	inputKey, err := hkdf.Key(sha256.New, shared, secret, string(info), 32)
	if err != nil {
		return nil, err
	}
	contentKey, err := hkdf.Key(sha256.New, inputKey, salt, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, inputKey, salt, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(contentKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	header := make([]byte, 0, saltSize+5+len(ourBytes))
	header = append(header, salt...)
	header = binary.BigEndian.AppendUint32(header, recordSize)
	header = append(header, byte(len(ourBytes)))
	header = append(header, ourBytes...)
	return gcm.Seal(header, nonce, append(append([]byte{}, plain...), lastRecord), nil), nil
}
