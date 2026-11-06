// Package ids creates random identifiers.
package ids

import (
	"crypto/rand"
	"encoding/base32"
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

// Slug returns a readable room address. The 40-bit suffix keeps a room's link
// from being guessed: there are about 4 x 10^14 of them.
func Slug() string {
	buffer := make([]byte, 5)
	_, _ = rand.Read(buffer) // crypto/rand never fails on supported platforms.
	return pick(adjectives) + "-" + pick(nouns) + "-" + encoding.EncodeToString(buffer)
}

// RoomNameFor names a room after its address, so people see one name and not two.
func RoomNameFor(slug string) string {
	words := strings.Split(slug, "-")
	if len(words) < 2 || words[0] == "" {
		return "Room"
	}
	return strings.ToUpper(words[0][:1]) + words[0][1:] + " " + words[1] + " room"
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
