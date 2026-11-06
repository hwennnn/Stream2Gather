// Package source turns links and searches into playable media.
package source

import (
	"context"
	"errors"
	"net/url"

	"stream2gather/internal/room"
)

// Errors a source can return. IsUserError lets these reach people as they are, so
// each is a whole sentence. web/src matches "not supported" in the first.
var (
	ErrUnsupportedURL = errors.New("That link is not supported yet.")
	ErrUnavailable    = errors.New("This video can’t be played here. Try another.")
	ErrNoSearch       = errors.New("Search isn’t available for this source.")
	ErrNoEmbed        = errors.New("This video can’t be embedded here.")
	ErrOverBudget     = errors.New("Search is resting until tomorrow. Paste a link instead.")
	ErrLive           = errors.New("Live streams aren’t supported yet.")
	ErrTooManyLinks   = errors.New("Too many new links. Try again later.")
	ErrLinksResting   = errors.New("New links are resting until tomorrow.")
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

// Metered is a source whose lookups spend something the whole site shares, such
// as an API quota, so a link it has to look up is charged and counted.
type Metered interface {
	Metered()
}

// Batcher is a source that can renew many videos at once.
type Batcher interface {
	// ResolveMany returns the videos that still exist and can be embedded.
	ResolveMany(ctx context.Context, ids []string) ([]room.Media, error)
}
