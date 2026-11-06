package migrations

import (
	"io/fs"
	"testing"

	"github.com/pressly/goose/v3"
)

// Goose panics on a repeated number at startup and refuses a file numbered below
// what a database has applied, and CI runs no Postgres to see either. Two branches
// that each took the next free number fail here instead.
func TestNumbersAreUniqueAndGapless(t *testing.T) {
	names, err := fs.Glob(FS, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for i, name := range names {
		number, err := goose.NumericComponent(name)
		if err != nil {
			t.Fatal(err)
		}
		if want := int64(i + 1); number != want {
			t.Fatalf("%s should be number %d: take the next free number when merging", name, want)
		}
	}
}
