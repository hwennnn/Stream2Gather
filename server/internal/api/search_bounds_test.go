package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
)

type countedSearch struct {
	calls   atomic.Int32
	regions atomic.Int32
	broken  error
}

func (*countedSearch) Name() string { return "youtube" }
func (*countedSearch) Match(*url.URL) (source.Ref, bool) {
	return source.Ref{}, false
}
func (*countedSearch) Resolve(context.Context, source.Ref) (room.Media, error) {
	return room.Media{}, source.ErrNoSearch
}
func (c *countedSearch) Search(_ context.Context, _, region string) ([]room.Media, error) {
	c.calls.Add(1)
	if region != "" {
		c.regions.Add(1)
	}
	return nil, c.broken
}
func (*countedSearch) Trending(context.Context) ([]room.Media, error) {
	return nil, source.ErrNoSearch
}

func searchServer(t *testing.T) (*Server, *countedSearch) {
	t.Helper()
	s, _ := stackServer(t)
	counted := &countedSearch{}
	s.Catalog = source.NewCatalog(s.DB, 1_000_000, s.Log, counted)
	return s, counted
}

func TestABrokenSourceIsAFriendlyFailure(t *testing.T) {
	s, counted := searchServer(t)
	counted.broken = errors.New("youtube said 500, with a key in the url")
	response, body := serve(s, http.MethodGet, "/v1/media/search?q=broken-"+ids.New(), "", from("broken-"+ids.New()))
	if response.Code != http.StatusServiceUnavailable || body["code"] != "search_unavailable" {
		t.Fatalf("code = %d, body = %v", response.Code, body)
	}
	if message, _ := body["message"].(string); !strings.Contains(message, "Paste a link") || strings.Contains(message, "youtube said") {
		t.Fatalf("message = %q", message)
	}
}

func TestALongSearchIsRefusedBeforeItSpendsQuota(t *testing.T) {
	s, counted := searchServer(t)
	response, body := serve(s, http.MethodGet, "/v1/media/search?q="+strings.Repeat("a", searchMaxQuery+1), "", from("long-"+ids.New()))
	if response.Code != http.StatusBadRequest || body["code"] != "invalid" {
		t.Fatalf("%d %v", response.Code, body)
	}
	if counted.calls.Load() != 0 {
		t.Fatal("the long search reached the source")
	}
}

func TestASearchAtTheLimitStillRuns(t *testing.T) {
	s, counted := searchServer(t)
	query := ids.New() + strings.Repeat("é", searchMaxQuery)
	query = string([]rune(query)[:searchMaxQuery])
	response, body := serve(s, http.MethodGet, "/v1/media/search?q="+url.QueryEscape(query), "", from("edge-"+ids.New()))
	if response.Code != http.StatusOK || counted.calls.Load() != 1 {
		t.Fatalf("%d %v, %d calls", response.Code, body, counted.calls.Load())
	}
}

func TestARegionCannotBustTheSearchCache(t *testing.T) {
	s, counted := searchServer(t)
	query := "region-" + ids.New()
	for _, region := range []string{"", "AA", "AB", "zz"} {
		path := "/v1/media/search?q=" + query + "&region=" + region
		if response, _ := serve(s, http.MethodGet, path, "", from("region-"+ids.New())); response.Code != http.StatusOK {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	if counted.calls.Load() != 1 || counted.regions.Load() != 0 {
		t.Fatalf("%d calls, %d with a region", counted.calls.Load(), counted.regions.Load())
	}
}
