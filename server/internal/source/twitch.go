package source

import (
	"context"
	"net/url"
	"regexp"
	"strings"

	"stream2gather/internal/room"
)

const (
	twitchName       = "twitch"
	twitchVideoTitle = "Twitch video"
	twitchVideo      = "video:"
	twitchChannel    = "channel:"
)

var (
	twitchVideoID = regexp.MustCompile(`^[0-9]{1,14}$`)
	twitchLogin   = regexp.MustCompile(`^[a-z0-9_]{2,25}$`)
)

// twitchPages are the top-level paths that aren't channels.
var twitchPages = map[string]bool{
	"directory": true, "downloads": true, "drops": true, "friends": true, "inventory": true, "jobs": true,
	"login": true, "messages": true, "p": true, "payments": true, "prime": true, "search": true,
	"settings": true, "signup": true, "store": true, "subscriptions": true, "turbo": true,
	"videos": true, "wallet": true,
}

// Twitch only ever reads the pasted link. Its agreement limits how long fetched
// metadata may be kept, so nothing is fetched and nothing needs expiring: a row
// holds the URL and what can be read from it, here and in room snapshots.
type Twitch struct{}

// Name returns the source identifier.
func (Twitch) Name() string { return twitchName }

// Match accepts past broadcasts and channels. Clips have no player API to sync
// against, so their links are left unmatched, along with Twitch's own pages.
func (Twitch) Match(link *url.URL) (Ref, bool) {
	host := strings.ToLower(link.Hostname())
	if host != "twitch.tv" && host != "www.twitch.tv" && host != "m.twitch.tv" {
		return Ref{}, false
	}
	parts := strings.Split(strings.Trim(link.Path, "/"), "/")
	video := ""
	switch {
	case len(parts) == 2 && parts[0] == "videos":
		video = parts[1]
	case len(parts) == 3 && (parts[1] == "video" || parts[1] == "v"):
		video = parts[2]
	case len(parts) == 1:
		login := strings.ToLower(parts[0])
		if !twitchLogin.MatchString(login) || twitchPages[login] {
			return Ref{}, false
		}
		return Ref{Source: twitchName, ID: twitchChannel + login, URL: "https://www.twitch.tv/" + login}, true
	}
	if !twitchVideoID.MatchString(video) {
		return Ref{}, false
	}
	return Ref{Source: twitchName, ID: twitchVideo + video, URL: "https://www.twitch.tv/videos/" + video}, true
}

// Resolve never calls Twitch. A deleted or subscriber-only video is only found
// out when it plays, and the player's error skips it as it does for YouTube.
func (Twitch) Resolve(_ context.Context, ref Ref) (room.Media, error) {
	media := room.Media{Source: twitchName, SourceID: ref.ID, URL: ref.URL, Title: twitchVideoTitle}
	if channel, ok := strings.CutPrefix(ref.ID, twitchChannel); ok {
		media.Title = channel
		media.IsLive = true
	}
	return media, nil
}

// Search is not available: it would need Twitch's API and its metadata limits.
func (Twitch) Search(context.Context, string, string) ([]room.Media, error) {
	return nil, ErrNoSearch
}

// Trending is not available for the same reason.
func (Twitch) Trending(context.Context) ([]room.Media, error) {
	return nil, ErrNoSearch
}
