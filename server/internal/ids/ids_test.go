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
