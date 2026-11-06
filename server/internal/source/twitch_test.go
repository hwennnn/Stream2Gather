package source

import (
	"context"
	"net/url"
	"testing"

	"stream2gather/internal/room"
)

func TestTwitchMatch(t *testing.T) {
	links := []struct{ link, id, canonical string }{
		{"https://www.twitch.tv/videos/2000000001", "video:2000000001", "https://www.twitch.tv/videos/2000000001"},
		{"https://twitch.tv/videos/2000000001?t=1h2m3s", "video:2000000001", "https://www.twitch.tv/videos/2000000001"},
		{"https://m.twitch.tv/videos/2000000001/", "video:2000000001", "https://www.twitch.tv/videos/2000000001"},
		{"https://www.twitch.tv/somebody/video/2000000001", "video:2000000001", "https://www.twitch.tv/videos/2000000001"},
		{"https://www.twitch.tv/somebody/v/2000000001", "video:2000000001", "https://www.twitch.tv/videos/2000000001"},
		{"https://www.twitch.tv/SomeBody_1", "channel:somebody_1", "https://www.twitch.tv/somebody_1"},
		{"https://m.twitch.tv/somebody/", "channel:somebody", "https://www.twitch.tv/somebody"},
		// Channels and videos can't collide, even on a name made of digits.
		{"https://www.twitch.tv/2000000001", "channel:2000000001", "https://www.twitch.tv/2000000001"},
	}
	for _, c := range links {
		parsed, _ := url.Parse(c.link)
		ref, ok := Twitch{}.Match(parsed)
		if !ok || ref.ID != c.id || ref.URL != c.canonical {
			t.Errorf("%s: ref = %+v, ok = %v", c.link, ref, ok)
		}
	}

	rejected := []string{
		"https://clips.twitch.tv/SomeClipSlug",
		"https://www.twitch.tv/somebody/clip/SomeClipSlug",
		"https://www.twitch.tv/somebody/videos",
		"https://www.twitch.tv/videos",
		"https://www.twitch.tv/videos/notanumber",
		"https://www.twitch.tv/directory",
		"https://www.twitch.tv/settings",
		"https://www.twitch.tv/",
		"https://www.twitch.tv/name-with-dash",
		"https://twitch.tv.evil.example/somebody",
		"https://evil.example/videos/2000000001",
	}
	for _, link := range rejected {
		parsed, _ := url.Parse(link)
		if ref, ok := (Twitch{}).Match(parsed); ok {
			t.Errorf("%s matched: %+v", link, ref)
		}
	}
}

// Twitch's agreement limits keeping its metadata, so a row may hold only what the
// link itself says: no author, thumbnail or duration, however a link is pasted.
func TestTwitchResolveStoresOnlyTheLink(t *testing.T) {
	cases := []struct {
		ref  Ref
		want room.Media
	}{
		{
			Ref{ID: "video:2000000001", URL: "https://www.twitch.tv/videos/2000000001"},
			room.Media{Source: "twitch", SourceID: "video:2000000001", URL: "https://www.twitch.tv/videos/2000000001", Title: "Twitch video"},
		},
		{
			Ref{ID: "channel:somebody", URL: "https://www.twitch.tv/somebody"},
			room.Media{Source: "twitch", SourceID: "channel:somebody", URL: "https://www.twitch.tv/somebody", Title: "somebody", IsLive: true},
		},
	}
	for _, c := range cases {
		media, err := Twitch{}.Resolve(context.Background(), c.ref)
		if err != nil || media != c.want {
			t.Errorf("%s: media = %+v, err = %v", c.ref.ID, media, err)
		}
	}
}
