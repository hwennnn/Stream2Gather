package api

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
)

// deadLinks answers like a video site for links that lead nowhere, and counts.
type deadLinks struct {
	source.Direct
	calls atomic.Int32
}

func (d *deadLinks) Metered() {}
func (d *deadLinks) Resolve(context.Context, source.Ref) (room.Media, error) {
	d.calls.Add(1)
	return room.Media{}, source.ErrUnavailable
}

func TestDeadLinksCountTowardsAnHourlyLimit(t *testing.T) {
	s, _ := stackServer(t)
	dead := &deadLinks{}
	s.Catalog = source.NewCatalog(s.DB, 0, s.Log, dead)
	ip := "links-" + ids.New()
	for range source.LookupsPerHour - 1 {
		if _, err := s.Live.Limit(context.Background(), "lookups:"+ip, source.LookupsPerHour, time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	cookie := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Ada"})
	post := func() (int, map[string]any) {
		response, body := serve(s, http.MethodPost, "/v1/rooms", `{"url":"https://a.test/`+ids.New()+`.mp4"}`, cookie, from(ip))
		return response.Code, body
	}

	if code, body := post(); code != http.StatusUnprocessableEntity {
		t.Fatalf("last lookup of the hour: %d %v", code, body)
	}
	for range 3 {
		if code, body := post(); code != http.StatusTooManyRequests {
			t.Fatalf("over the limit: %d %v", code, body)
		}
	}
	if dead.calls.Load() != 1 {
		t.Fatalf("the source was called %d times, want 1", dead.calls.Load())
	}
}
