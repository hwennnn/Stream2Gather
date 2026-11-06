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
	"stream2gather/internal/testenv"
)

type fakeClerk struct{ identity auth.Identity }

func (f fakeClerk) Verify(_ context.Context, token string) (auth.Identity, error) {
	switch token {
	case "good":
		return f.identity, nil
	case "other":
		return auth.Identity{ClerkID: f.identity.ClerkID + "_other", Name: "Grace"}, nil
	}
	return auth.Identity{}, auth.ErrInvalidToken
}

// This test needs the stack from deploy/compose.yaml and skips without it.
func sessionServer(t *testing.T) *httptest.Server {
	t.Helper()
	test, _ := sessionStack(t)
	return test
}

func sessionStack(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	pool, err := pgxpool.New(context.Background(), testenv.PostgresURL())
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(pool.Close)
	rdb := redis.NewClient(&redis.Options{Addr: testenv.RedisAddr()})
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
	return test, server
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

// merged is what a browser holds after a response replaces some of its cookies.
func merged(held, set []*http.Cookie) []*http.Cookie {
	if len(set) > 0 {
		return set
	}
	return held
}

func meOf(t *testing.T, test *httptest.Server, cookies []*http.Cookie) map[string]any {
	t.Helper()
	_, body := call(t, http.MethodGet, test.URL+"/v1/me", "", cookies)
	user, _ := body["user"].(map[string]any)
	return user
}

func ticketFor(t *testing.T, test *httptest.Server, server *Server, slug string, cookies []*http.Cookie) store.Person {
	t.Helper()
	response, body := call(t, http.MethodPost, test.URL+"/v1/rooms/"+slug+"/ticket", "", cookies)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("ticket: %d %v", response.StatusCode, body)
	}
	id, _ := body["ticket"].(string)
	ticket, found, err := server.Live.TakeTicket(context.Background(), id)
	if err != nil || !found {
		t.Fatalf("ticket %q: found %v, err %v", id, found, err)
	}
	return ticket.Person
}

func signInAs(t *testing.T, test *httptest.Server, token string, cookies []*http.Cookie) []*http.Cookie {
	t.Helper()
	response, body := call(t, http.MethodPost, test.URL+"/v1/session/clerk", token, cookies)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("sign-in: %d %v", response.StatusCode, body)
	}
	return response.Cookies()
}

func TestAnOldGuestCookieIsNeverTheAccount(t *testing.T) {
	test, server := sessionStack(t)
	response, body := call(t, http.MethodPost, test.URL+"/v1/rooms", "", nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", response.StatusCode, body)
	}
	slug, _ := body["slug"].(string)
	guestCookie := response.Cookies()
	guest := meOf(t, test, guestCookie)

	account := signInAs(t, test, "good", guestCookie)

	user := meOf(t, test, account)
	if user["id"] == guest["id"] || !strings.HasPrefix(user["id"].(string), "u_") {
		t.Fatalf("account %v, guest %v", user, guest)
	}
	// The room came along, and the new socket shows the account's name and picture.
	person := ticketFor(t, test, server, slug, account)
	if person.Role != "host" || person.Name != "Ada" || person.AvatarURL != "https://img.clerk.com/a" || person.UserID != user["id"] {
		t.Fatalf("account in its room = %+v", person)
	}

	if old := meOf(t, test, guestCookie); old["id"] != guest["id"] || old["signedIn"] != false {
		t.Fatalf("old guest cookie = %v", old)
	}
	if person := ticketFor(t, test, server, slug, guestCookie); person.Role != "member" || person.UserID == user["id"] {
		t.Fatalf("old guest cookie in the room = %+v", person)
	}
}

func TestSigningInOverAnAccountMovesNothing(t *testing.T) {
	test, server := sessionStack(t)
	ada := signInAs(t, test, "good", nil)
	response, body := call(t, http.MethodPost, test.URL+"/v1/rooms", "", ada)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", response.StatusCode, body)
	}
	slug, _ := body["slug"].(string)

	grace := signInAs(t, test, "other", ada)

	record, err := server.DB.RoomBySlug(context.Background(), slug)
	if err != nil {
		t.Fatal(err)
	}
	if record.OwnerID != meOf(t, test, ada)["id"] {
		t.Fatalf("room moved to %q", record.OwnerID)
	}
	if user := meOf(t, test, grace); user["name"] != "Grace" || user["id"] == record.OwnerID {
		t.Fatalf("second account = %v", user)
	}
}

func TestSignOutInvalidatesCopiesOfTheCookie(t *testing.T) {
	test := sessionServer(t)
	copied := signInAs(t, test, "good", nil)
	if meOf(t, test, copied) == nil {
		t.Fatal("not signed in")
	}

	call(t, http.MethodDelete, test.URL+"/v1/session", "", copied)

	if user := meOf(t, test, copied); user != nil {
		t.Fatalf("a copy of the cookie still works: %v", user)
	}
	// It is treated as no cookie at all, so the next action starts a guest.
	response, body := call(t, http.MethodPost, test.URL+"/v1/rooms", "", copied)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", response.StatusCode, body)
	}
	if user := meOf(t, test, merged(copied, response.Cookies())); user["signedIn"] != false {
		t.Fatalf("after sign-out = %v", user)
	}

	fresh := signInAs(t, test, "good", copied)
	if user := meOf(t, test, fresh); user["signedIn"] != true {
		t.Fatalf("signing in again = %v", user)
	}
	if user := meOf(t, test, copied); user != nil {
		t.Fatalf("signing in again revived the old cookie: %v", user)
	}
}

func TestRenameKeepsASignedInCookieValid(t *testing.T) {
	test := sessionServer(t)
	first := signInAs(t, test, "good", nil)
	call(t, http.MethodDelete, test.URL+"/v1/session", "", first)
	cookies := signInAs(t, test, "good", nil) // At version 1, so a lost version would show.

	request, err := http.NewRequest(http.MethodPatch, test.URL+"/v1/me", strings.NewReader(`{"name":"Countess"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookies[0])
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if user := meOf(t, test, response.Cookies()); user["name"] != "Countess" || user["signedIn"] != true {
		t.Fatalf("after rename = %v", user)
	}
}

func TestCookiesFromBeforeVersionsWorkUntilSignOut(t *testing.T) {
	test, server := sessionStack(t)
	id := meOf(t, test, signInAs(t, test, "good", nil))["id"].(string)
	token, err := server.Issuer.Issue(auth.Claims{Subject: id, Name: "Ada", Account: true}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cookies := []*http.Cookie{{Name: sessionCookie, Value: token}}
	if meOf(t, test, cookies) == nil {
		t.Fatal("an existing session was dropped")
	}
	call(t, http.MethodDelete, test.URL+"/v1/session", "", cookies)
	if user := meOf(t, test, cookies); user != nil {
		t.Fatalf("still signed in: %v", user)
	}
}

func TestSignedInCookieForAMissingUserIsRefused(t *testing.T) {
	test, server := sessionStack(t)
	token, err := server.Issuer.Issue(auth.Claims{Subject: "u_" + ids.New(), Name: "Ghost", Account: true}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if user := meOf(t, test, []*http.Cookie{{Name: sessionCookie, Value: token}}); user != nil {
		t.Fatalf("me = %v", user)
	}
}

func TestContentPolicyOnlyAllowsClerkWhenConfigured(t *testing.T) {
	if strings.Contains(contentPolicy(policy{}), "clerk") {
		t.Fatal("clerk allowed without keys")
	}
	policy := contentPolicy(policy{ClerkHost: "x.clerk.accounts.dev"})
	for _, want := range []string{"script-src 'self' https://www.youtube.com https://s.ytimg.com https://x.clerk.accounts.dev", "https://img.clerk.com"} {
		if !strings.Contains(policy, want) {
			t.Errorf("policy missing %q: %s", want, policy)
		}
	}
}
