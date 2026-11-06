package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
)

func TestARequestHasADeadline(t *testing.T) {
	handler := withDeadline(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			if !errors.Is(r.Context().Err(), context.DeadlineExceeded) {
				t.Errorf("ended with %v", r.Context().Err())
			}
		case <-time.After(time.Second):
			t.Error("a stuck dependency would hold this request forever")
		}
	}), 10*time.Millisecond)
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

// A row lock stands in for a stuck database.
func TestARouteGivesUpOnAStuckDatabase(t *testing.T) {
	s, pool := stackServer(t)
	s.requestTimeout = 100 * time.Millisecond
	ctx := context.Background()
	user := "g_" + ids.New()
	if err := s.DB.EnsureUser(ctx, user, "Ada"); err != nil {
		t.Fatal(err)
	}
	lock, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Rollback(ctx) }()
	if _, err := lock.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, user); err != nil {
		t.Fatal(err)
	}

	cookie := signedIn(t, s, auth.Claims{Subject: user, Name: "Ada"})
	answered := make(chan int, 1)
	go func() {
		recorder, _ := serve(s, http.MethodPatch, "/v1/me", `{"name":"Grace"}`, cookie)
		answered <- recorder.Code
	}()
	select {
	case code := <-answered:
		if code != http.StatusInternalServerError {
			t.Fatalf("status %d", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the request is still waiting on the database")
	}
}
