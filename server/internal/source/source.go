// Package source turns links and searches into playable media.
package source

import (
	"context"
	"errors"
	"net/url"

	"stream2gather/internal/room"
)

// Errors a source can return.
var (
	ErrUnsupportedURL = errors.New("this link is not supported")
	ErrUnavailable    = errors.New("This video can’t be played here. Try another.")
	ErrNoSearch       = errors.New("this source has no search")
	ErrOverBudget     = errors.New("search is resting until tomorrow")
	ErrLive           = errors.New("Live streams aren’t supported yet.")
)

// Ref points at one video on a source.
type Ref struct {
	Source string
	ID     string
	URL    string
}

// Source adapts one video platform.
type Source interface {
	Name() string
	// Match reports whether a link belongs to this source.
	Match(link *url.URL) (Ref, bool)
	// Resolve fetches metadata, or fails if the video cannot be embedded.
	Resolve(ctx context.Context, ref Ref) (room.Media, error)
	Search(ctx context.Context, query, region string) ([]room.Media, error)
	Trending(ctx context.Context) ([]room.Media, error)
}

// Batcher is a source that can renew many videos at once.
type Batcher interface {
	// ResolveMany returns the videos that still exist and can be embedded.
	ResolveMany(ctx context.Context, ids []string) ([]room.Media, error)
}
