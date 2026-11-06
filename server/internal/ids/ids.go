// Package ids creates random identifiers.
package ids

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"math/big"
	"strings"
)

var encoding = base32.NewEncoding("0123456789abcdefghjkmnpqrstvwxyz").WithPadding(base32.NoPadding)

// New returns a 128-bit random id.
func New() string {
	buffer := make([]byte, 16)
	_, _ = rand.Read(buffer) // crypto/rand never fails on supported platforms.
	return encoding.EncodeToString(buffer)
}

var (
	adjectives = strings.Fields("amber brave calm cosmic cozy electric golden hidden lazy lucky mellow midnight neon quiet rapid silver sleepy solar velvet wild")
	nouns      = strings.Fields("otter falcon comet lantern meadow panda harbor maple pixel raven rocket sparrow tiger tulip walrus willow zebra cinema popcorn sofa")
)

func pick(words []string) string {
	index, _ := rand.Int(rand.Reader, big.NewInt(int64(len(words))))
	return words[index.Int64()]
}

// Slug returns a readable room address.
func Slug() string {
	suffix, _ := rand.Int(rand.Reader, big.NewInt(10000))
	return fmt.Sprintf("%s-%s-%04d", pick(adjectives), pick(nouns), suffix.Int64())
}

// RoomName returns a friendly default name.
func RoomName() string {
	word := pick(adjectives)
	return strings.ToUpper(word[:1]) + word[1:] + " " + pick(nouns) + " room"
}

// GuestName returns a friendly default display name.
func GuestName() string {
	word := pick(nouns)
	return pick(adjectivesTitle()) + " " + strings.ToUpper(word[:1]) + word[1:]
}

func adjectivesTitle() []string {
	titled := make([]string, len(adjectives))
	for i, word := range adjectives {
		titled[i] = strings.ToUpper(word[:1]) + word[1:]
	}
	return titled
}
