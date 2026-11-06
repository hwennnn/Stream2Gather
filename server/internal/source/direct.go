package source

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"path"
	"strings"

	"stream2gather/internal/room"
)

const directName = "direct"

// Direct plays a media file by URL in the browser. The server never fetches the
// URL. It stays off unless ALLOW_DIRECT_MEDIA is set.
type Direct struct {
	// HTTPSOnly refuses plain http even on this machine, for anywhere but dev.
	HTTPSOnly bool
}

// Name returns the source identifier.
func (Direct) Name() string { return directName }

// Match accepts media file links.
func (d Direct) Match(link *url.URL) (Ref, bool) {
	local := link.Scheme == "http" && (link.Hostname() == "127.0.0.1" || link.Hostname() == "localhost")
	if link.Scheme != "https" && (d.HTTPSOnly || !local) {
		return Ref{}, false
	}
	switch strings.ToLower(path.Ext(link.Path)) {
	case ".mp4", ".webm", ".m3u8":
		sum := sha256.Sum256([]byte(link.String()))
		return Ref{Source: directName, ID: hex.EncodeToString(sum[:12]), URL: link.String()}, true
	}
	return Ref{}, false
}

// Resolve names the video after its file. The browser finds its duration.
func (Direct) Resolve(_ context.Context, ref Ref) (room.Media, error) {
	link, err := url.Parse(ref.URL)
	if err != nil {
		return room.Media{}, ErrUnsupportedURL
	}
	return room.Media{
		Source:   directName,
		SourceID: ref.ID,
		URL:      ref.URL,
		Title:    path.Base(link.Path),
		Author:   link.Hostname(),
	}, nil
}

// Search is not available for direct links.
func (Direct) Search(context.Context, string, string) ([]room.Media, error) {
	return nil, ErrNoSearch
}

// Trending is not available for direct links.
func (Direct) Trending(context.Context) ([]room.Media, error) {
	return nil, ErrNoSearch
}
