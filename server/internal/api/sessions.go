package api

import (
	"context"
	"sync"
	"time"
)

const (
	// sessionCheckTTL is how long a sign-out on another server can go unnoticed
	// here. A sign-out on this server takes effect at once.
	sessionCheckTTL = 5 * time.Second
	maxCheckedUsers = 10_000
)

// sessionVersions remembers each account's session version for a moment, so
// that a signed-in viewer's requests rarely cost a query. The zero value is ready.
type sessionVersions struct {
	mu   sync.Mutex
	seen map[string]checkedVersion
	now  func() time.Time
}

type checkedVersion struct {
	version int64
	at      time.Time
}

func (v *sessionVersions) clock() time.Time {
	if v.now != nil {
		return v.now()
	}
	return time.Now()
}

func (v *sessionVersions) current(ctx context.Context, id string, load func(context.Context, string) (int64, error)) (int64, error) {
	v.mu.Lock()
	checked, found := v.seen[id]
	v.mu.Unlock()
	if found && v.clock().Sub(checked.at) < sessionCheckTTL {
		return checked.version, nil
	}

	version, err := load(ctx, id)
	if err != nil {
		return 0, err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.seen == nil || len(v.seen) >= maxCheckedUsers {
		v.seen = map[string]checkedVersion{}
	}
	v.seen[id] = checkedVersion{version: version, at: v.clock()}
	return version, nil
}

func (v *sessionVersions) forget(id string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	delete(v.seen, id)
}
