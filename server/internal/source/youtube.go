package source

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"stream2gather/internal/room"
)

const (
	youtubeName  = "youtube"
	youtubeBatch = 50
)

var (
	youtubeID       = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	isoDuration     = regexp.MustCompile(`^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$`)
	youtubePathKind = map[string]bool{"shorts": true, "embed": true, "live": true, "v": true}
)

// YouTube reads the YouTube Data API. Playback uses the official player only.
type YouTube struct {
	key     string
	baseURL string
	client  *http.Client
}

// NewYouTube returns the adapter.
func NewYouTube(key, baseURL string) *YouTube {
	return &YouTube{key: key, baseURL: baseURL, client: &http.Client{Timeout: 8 * time.Second}}
}

// Name returns the source identifier.
func (y *YouTube) Name() string { return youtubeName }

// Metered says every call here spends the key's daily quota.
func (y *YouTube) Metered() {}

// Match recognises every common YouTube link form.
func (y *YouTube) Match(link *url.URL) (Ref, bool) {
	host := strings.TrimPrefix(strings.ToLower(link.Hostname()), "www.")
	host = strings.TrimPrefix(host, "m.")
	host = strings.TrimPrefix(host, "music.")
	path := strings.Split(strings.Trim(link.Path, "/"), "/")

	var id string
	switch host {
	case "youtu.be":
		id = path[0]
	case "youtube.com", "youtube-nocookie.com":
		if path[0] == "watch" {
			id = link.Query().Get("v")
		} else if len(path) >= 2 && youtubePathKind[path[0]] {
			id = path[1]
		}
	}
	if !youtubeID.MatchString(id) {
		return Ref{}, false
	}
	return Ref{Source: youtubeName, ID: id, URL: "https://www.youtube.com/watch?v=" + id}, true
}

type youtubeVideo struct {
	ID      string `json:"id"`
	Snippet struct {
		Title                string `json:"title"`
		ChannelTitle         string `json:"channelTitle"`
		LiveBroadcastContent string `json:"liveBroadcastContent"`
		Thumbnails           map[string]struct {
			URL string `json:"url"`
		} `json:"thumbnails"`
	} `json:"snippet"`
	ContentDetails struct {
		Duration          string `json:"duration"`
		RegionRestriction struct {
			Allowed []string `json:"allowed"`
			Blocked []string `json:"blocked"`
		} `json:"regionRestriction"`
	} `json:"contentDetails"`
	Status struct {
		Embeddable    bool   `json:"embeddable"`
		PrivacyStatus string `json:"privacyStatus"`
	} `json:"status"`
}

func (v youtubeVideo) media() room.Media {
	thumbnail := ""
	for _, size := range []string{"maxres", "standard", "high", "medium", "default"} {
		if candidate, ok := v.Snippet.Thumbnails[size]; ok {
			thumbnail = candidate.URL
			break
		}
	}
	return room.Media{
		Source:       youtubeName,
		SourceID:     v.ID,
		URL:          "https://www.youtube.com/watch?v=" + v.ID,
		Title:        html.UnescapeString(v.Snippet.Title),
		Author:       html.UnescapeString(v.Snippet.ChannelTitle),
		ThumbnailURL: thumbnail,
		DurationMS:   parseDuration(v.ContentDetails.Duration),
		IsLive:       v.live(),

		AllowedRegions: strings.Join(v.ContentDetails.RegionRestriction.Allowed, " "),
		BlockedRegions: strings.Join(v.ContentDetails.RegionRestriction.Blocked, " "),
	}
}

// live covers a stream that has been announced, since it cannot play yet either.
func (v youtubeVideo) live() bool {
	return v.Snippet.LiveBroadcastContent == "live" || v.Snippet.LiveBroadcastContent == "upcoming"
}

func (v youtubeVideo) playable() bool {
	return v.Status.Embeddable && v.Status.PrivacyStatus == "public"
}

func parseDuration(value string) int64 {
	match := isoDuration.FindStringSubmatch(value)
	if match == nil {
		return 0
	}
	var seconds int64
	for i, unit := range []int64{86400, 3600, 60, 1} {
		if match[i+1] != "" {
			amount, _ := strconv.ParseInt(match[i+1], 10, 64)
			seconds += amount * unit
		}
	}
	return seconds * 1000
}

// Resolve costs one quota unit.
func (y *YouTube) Resolve(ctx context.Context, ref Ref) (room.Media, error) {
	videos, err := y.videos(ctx, url.Values{"id": {ref.ID}})
	if err != nil {
		return room.Media{}, err
	}
	if len(videos) == 0 || !videos[0].playable() {
		return room.Media{}, ErrUnavailable
	}
	if videos[0].live() {
		return room.Media{}, ErrLive
	}
	return videos[0].media(), nil
}

// ResolveMany costs one quota unit per 50 videos.
func (y *YouTube) ResolveMany(ctx context.Context, ids []string) ([]room.Media, error) {
	items := make([]room.Media, 0, len(ids))
	for start := 0; start < len(ids); start += youtubeBatch {
		end := min(start+youtubeBatch, len(ids))
		videos, err := y.videos(ctx, url.Values{"id": {strings.Join(ids[start:end], ",")}})
		if err != nil {
			return nil, err
		}
		items = append(items, playableMedia(videos)...)
	}
	return items, nil
}

// Search spends a call from YouTube's small search.list allowance, so callers
// cache it and check the budget first.
func (y *YouTube) Search(ctx context.Context, query, region string) ([]room.Media, error) {
	params := url.Values{
		"part":            {"id"},
		"type":            {"video"},
		"q":               {query},
		"maxResults":      {"25"},
		"videoEmbeddable": {"true"},
		"safeSearch":      {"moderate"},
	}
	if region != "" {
		params.Set("regionCode", region)
	}

	var response struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
		} `json:"items"`
	}
	if err := y.get(ctx, "/search", params, &response); err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(response.Items))
	for _, item := range response.Items {
		if item.ID.VideoID != "" {
			ids = append(ids, item.ID.VideoID)
		}
	}
	if len(ids) == 0 {
		return []room.Media{}, nil
	}

	videos, err := y.videos(ctx, url.Values{"id": {strings.Join(ids, ",")}})
	if err != nil {
		return nil, err
	}
	return playableMedia(videos), nil
}

// Trending costs one quota unit.
func (y *YouTube) Trending(ctx context.Context) ([]room.Media, error) {
	videos, err := y.videos(ctx, url.Values{
		"chart": {"mostPopular"}, "regionCode": {"US"}, "maxResults": {"50"},
	})
	if err != nil {
		return nil, err
	}
	return playableMedia(videos), nil
}

func playableMedia(videos []youtubeVideo) []room.Media {
	items := make([]room.Media, 0, len(videos))
	for _, video := range videos {
		if video.playable() {
			items = append(items, video.media())
		}
	}
	return items
}

func (y *YouTube) videos(ctx context.Context, params url.Values) ([]youtubeVideo, error) {
	params.Set("part", "snippet,contentDetails,status")
	var response struct {
		Items []youtubeVideo `json:"items"`
	}
	if err := y.get(ctx, "/videos", params, &response); err != nil {
		return nil, err
	}
	return response.Items, nil
}

func (y *YouTube) get(ctx context.Context, path string, params url.Values, out any) error {
	if y.key == "" {
		return errors.New("YOUTUBE_API_KEY is not set")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, y.baseURL+path+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	// A header keeps the key out of URLs, which errors and logs would repeat.
	request.Header.Set("x-goog-api-key", y.key)

	response, err := y.client.Do(request)
	if err != nil {
		return fmt.Errorf("youtube %s: %w", path, err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("youtube %s: %w", path, err)
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Error struct {
				Errors []struct {
					Reason string `json:"reason"`
				} `json:"errors"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &failure)
		reason := "unknown"
		if len(failure.Error.Errors) > 0 {
			reason = failure.Error.Errors[0].Reason
		}
		if reason == "quotaExceeded" || reason == "dailyLimitExceeded" {
			return ErrOverBudget
		}
		return fmt.Errorf("youtube %s: status %d: %s", path, response.StatusCode, reason)
	}
	return json.Unmarshal(body, out)
}
