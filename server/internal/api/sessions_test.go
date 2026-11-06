package api

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestSessionVersionsAreCachedBriefly(t *testing.T) {
	now := time.Unix(1000, 0)
	versions := sessionVersions{now: func() time.Time { return now }}
	loads := 0
	load := func(context.Context, string) (int64, error) {
		loads++
		return int64(loads), nil
	}
	read := func() int64 {
		t.Helper()
		version, err := versions.current(context.Background(), "u_1", load)
		if err != nil {
			t.Fatal(err)
		}
		return version
	}

	if first, second := read(), read(); first != 1 || second != 1 || loads != 1 {
		t.Fatalf("got %d then %d after %d loads", first, second, loads)
	}
	now = now.Add(sessionCheckTTL)
	if version := read(); version != 2 {
		t.Fatalf("after the TTL: version %d", version)
	}
	versions.forget("u_1")
	if version := read(); version != 3 {
		t.Fatalf("after forget: version %d", version)
	}
}

func TestFailedSessionLookupsAreNotCached(t *testing.T) {
	var versions sessionVersions
	failure := errors.New("database down")
	_, err := versions.current(context.Background(), "u_1", func(context.Context, string) (int64, error) { return 0, failure })
	if !errors.Is(err, failure) {
		t.Fatalf("err = %v", err)
	}
	version, err := versions.current(context.Background(), "u_1", func(context.Context, string) (int64, error) { return 7, nil })
	if err != nil || version != 7 {
		t.Fatalf("version %d, err %v", version, err)
	}
}

func TestSessionVersionCacheStaysBounded(t *testing.T) {
	var versions sessionVersions
	load := func(context.Context, string) (int64, error) { return 1, nil }
	for i := range maxCheckedUsers + 10 {
		if _, err := versions.current(context.Background(), string(rune(i)), load); err != nil {
			t.Fatal(err)
		}
	}
	if len(versions.seen) > maxCheckedUsers {
		t.Fatalf("%d entries", len(versions.seen))
	}
}
