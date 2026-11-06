package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/store"
)

type fakeClerk struct{ identity auth.Identity }

func (f fakeClerk) Verify(_ context.Context, token string) (auth.Identity, error) {
	if token != "good" {
		return auth.Identity{}, auth.ErrInvalidToken
	}
	return f.identity, nil
}

// This test needs the stack from deploy/compose.yaml and skips without it.
func sessionServer(t *testing.T) *httptest.Server {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	pool, err := pgxpool.New(context.Background(), "postgres://s2g:s2g@127.0.0.1:54339/s2g?sslmode=disable")
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(pool.Close)
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:63809"})
	t.Cleanup(func() { _ = rdb.Close() })
	if pool.Ping(ctx) != nil || rdb.Ping(ctx).Err() != nil {
		t.Skip("stack not running")
	}

	seed := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	issuer, err := auth.NewIssuer(seed)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: store.NewPostgres(pool), Live: store.NewLive(rdb), Issuer: issuer,
		Clerk: fakeClerk{auth.Identity{ClerkID: "user_" + ids.New(), Name: "Ada", AvatarURL: "https://img.clerk.com/a"}},
	}
	test := httptest.NewServer(server.Handler())
	t.Cleanup(test.Close)
	return test
}

func call(t *testing.T, method, url, token string, cookies []*http.Cookie) (*http.Response, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(response.Body).Decode(&body)
	return response, body
}

func TestClerkSessionRejectsBadTokens(t *testing.T) {
	test := sessionServer(t)
	for _, token := range []string{"", "forged"} {
		response, _ := call(t, http.MethodPost, test.URL+"/v1/session/clerk", token, nil)
		if response.StatusCode != http.StatusUnauthorized {
			t.Errorf("token %q: status %d", token, response.StatusCode)
		}
		if len(response.Cookies()) != 0 {
			t.Errorf("token %q set a cookie", token)
		}
	}
}

func TestClerkSessionSignsInAndOut(t *testing.T) {
	test := sessionServer(t)
	response, body := call(t, http.MethodPost, test.URL+"/v1/session/clerk", "good", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %v", response.StatusCode, body)
	}
	cookies := response.Cookies()

	_, me := call(t, http.MethodGet, test.URL+"/v1/me", "", cookies)
	user, _ := me["user"].(map[string]any)
	if user["name"] != "Ada" || user["signedIn"] != true || user["avatarUrl"] != "https://img.clerk.com/a" {
		t.Fatalf("me = %v", me)
	}

	response, _ = call(t, http.MethodDelete, test.URL+"/v1/session", "", cookies)
	if cleared := response.Cookies(); len(cleared) != 1 || cleared[0].MaxAge >= 0 {
		t.Fatalf("cookie not cleared: %v", cleared)
	}
}

func TestContentPolicyOnlyAllowsClerkWhenConfigured(t *testing.T) {
	if strings.Contains(contentPolicy("", "", false), "clerk") {
		t.Fatal("clerk allowed without keys")
	}
	policy := contentPolicy("x.clerk.accounts.dev", "", false)
	for _, want := range []string{"script-src 'self' https://www.youtube.com https://s.ytimg.com https://x.clerk.accounts.dev", "https://img.clerk.com"} {
		if !strings.Contains(policy, want) {
			t.Errorf("policy missing %q: %s", want, policy)
		}
	}
}
