package ids

import (
	"regexp"
	"testing"
)

func TestSlugHasEnoughRandomness(t *testing.T) {
	shape := regexp.MustCompile(`^[a-z]+-[a-z]+-[0-9a-z]{8}$`)
	seen := map[string]bool{}
	for range 1000 {
		slug := Slug()
		if !shape.MatchString(slug) || seen[slug] {
			t.Fatalf("slug %q, seen before: %v", slug, seen[slug])
		}
		seen[slug] = true
	}
}

func TestARoomHasOneName(t *testing.T) {
	for slug, want := range map[string]string{
		"sleepy-maple-ztcecw5k": "Sleepy maple room",
		"amber-otter-x2mb4e28":  "Amber otter room",
	} {
		if got := RoomNameFor(slug); got != want {
			t.Fatalf("RoomNameFor(%q) = %q, want %q", slug, got, want)
		}
	}
}
