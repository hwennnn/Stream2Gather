package source

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"stream2gather/internal/room"
)

const (
	vimeoName    = "vimeo"
	vimeoBaseURL = "https://vimeo.com/api/oembed.json"
)

var (
	vimeoID   = regexp.MustCompile(`^[0-9]{6,12}$`)
	vimeoHash = regexp.MustCompile(`^[0-9a-f]{6,20}$`)
)

// Vimeo reads metadata from oEmbed, which needs no key. An unlisted video's
// source ID is "id:hash", because the hash is what lets the player open it.
type Vimeo struct {
	baseURL string
	client  *http.Client
}

// NewVimeo creates the source. An empty baseURL means the real oEmbed endpoint.
func NewVimeo(baseURL string) *Vimeo {
	if baseURL == "" {
		baseURL = vimeoBaseURL
	}
	return &Vimeo{baseURL: baseURL, client: &http.Client{Timeout: 8 * time.Second}}
}

// Name returns the source identifier.
func (*Vimeo) Name() string { return vimeoName }

// Metered makes a dead link cost the address that pasted it. The call is free,
// but it is still this server's name on every request Vimeo sees.
func (*Vimeo) Metered() {}

// Match accepts video pages, channel, group and showcase pages that name a
// video, and the player's own links. The ID and hash are rebuilt into a clean
// link, so nothing else from the pasted URL reaches Vimeo.
func (*Vimeo) Match(link *url.URL) (Ref, bool) {
	host := strings.TrimPrefix(strings.ToLower(link.Hostname()), "www.")
	if host != "vimeo.com" && host != "player.vimeo.com" {
		return Ref{}, false
	}
	parts := strings.Split(strings.Trim(link.Path, "/"), "/")
	id, hash := "", link.Query().Get("h")
	switch {
	case host == "player.vimeo.com":
		if len(parts) == 2 && parts[0] == "video" {
			id = parts[1]
		}
	case len(parts) == 1:
		id = parts[0]
	case len(parts) == 2 && vimeoID.MatchString(parts[0]):
		id, hash = parts[0], parts[1]
	case len(parts) == 3 && parts[0] == "channels":
		id = parts[2]
	case len(parts) == 4 && parts[2] == "video" && (parts[0] == "showcase" || parts[0] == "album"):
		id = parts[3]
	case len(parts) == 4 && parts[2] == "videos" && parts[0] == "groups":
		id = parts[3]
	}
	if !vimeoID.MatchString(id) || (hash != "" && !vimeoHash.MatchString(hash)) {
		return Ref{}, false
	}
	if hash == "" {
		return Ref{Source: vimeoName, ID: id, URL: "https://vimeo.com/" + id}, true
	}
	return Ref{Source: vimeoName, ID: id + ":" + hash, URL: "https://vimeo.com/" + id + "/" + hash}, true
}

// Resolve refuses what Vimeo says can't be embedded, private or restricted to
// other domains. Those answer 403 or 404, or 200 with domain_status_code 403.
func (v *Vimeo) Resolve(ctx context.Context, ref Ref) (room.Media, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, v.baseURL+"?"+url.Values{"url": {ref.URL}}.Encode(), nil)
	if err != nil {
		return room.Media{}, err
	}
	response, err := v.client.Do(request)
	if err != nil {
		return room.Media{}, fmt.Errorf("vimeo oembed: %w", err)
	}
	defer response.Body.Close()

	switch response.StatusCode {
	case http.StatusOK:
	case http.StatusForbidden, http.StatusNotFound:
		return room.Media{}, ErrNoEmbed
	default:
		return room.Media{}, fmt.Errorf("vimeo oembed: status %d", response.StatusCode)
	}

	var video struct {
		Title            string `json:"title"`
		AuthorName       string `json:"author_name"`
		ThumbnailURL     string `json:"thumbnail_url"`
		Duration         int64  `json:"duration"`
		DomainStatusCode int    `json:"domain_status_code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&video); err != nil {
		return room.Media{}, fmt.Errorf("vimeo oembed: %w", err)
	}
	if video.DomainStatusCode == http.StatusForbidden {
		return room.Media{}, ErrNoEmbed
	}
	return room.Media{
		Source:       vimeoName,
		SourceID:     ref.ID,
		URL:          ref.URL,
		Title:        video.Title,
		Author:       video.AuthorName,
		ThumbnailURL: video.ThumbnailURL,
		DurationMS:   video.Duration * 1000,
	}, nil
}

// Search is not available: oEmbed only answers for a known video.
func (*Vimeo) Search(context.Context, string, string) ([]room.Media, error) {
	return nil, ErrNoSearch
}

// Trending is not available for the same reason.
func (*Vimeo) Trending(context.Context) ([]room.Media, error) {
	return nil, ErrNoSearch
}
