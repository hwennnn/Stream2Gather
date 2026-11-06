package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stream2gather/internal/auth"
	"stream2gather/internal/hub"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
	"stream2gather/internal/testenv"
)

const testSeed = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

func offlineServer(t *testing.T) *Server {
	t.Helper()
	issuer, err := auth.NewIssuer(testSeed)
	if err != nil {
		t.Fatal(err)
	}
	return &Server{Issuer: issuer}
}

func stackServer(t *testing.T) (*Server, *pgxpool.Pool) {
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
	s := offlineServer(t)
	s.DB, s.Live, s.TrustedProxy = store.NewPostgres(pool), store.NewLive(rdb), true
	s.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	s.Catalog = source.NewCatalog(s.DB, 0, s.Log, source.NewYouTube("", ""))
	return s, pool
}

func newRoom(t *testing.T, s *Server, state room.State) store.Room {
	t.Helper()
	ctx := context.Background()
	owner := "g_" + ids.New()
	if err := s.DB.EnsureUser(ctx, owner, "Owner"); err != nil {
		t.Fatal(err)
	}
	record := store.Room{ID: ids.New(), Slug: ids.Slug(), Name: "Room", OwnerID: owner}
	if err := s.DB.CreateRoom(ctx, record); err != nil {
		t.Fatal(err)
	}
	if err := s.Live.Seed(ctx, record.ID, state); err != nil {
		t.Fatal(err)
	}
	return record
}

func serve(s *Server, method, path, body string, edit ...func(*http.Request)) (*httptest.ResponseRecorder, map[string]any) {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	for _, change := range edit {
		change(request)
	}
	recorder := httptest.NewRecorder()
	s.Handler().ServeHTTP(recorder, request)
	var decoded map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &decoded)
	return recorder, decoded
}

func from(ip string) func(*http.Request) {
	return func(r *http.Request) { r.Header.Set("X-Forwarded-For", ip) }
}

func signedIn(t *testing.T, s *Server, claims auth.Claims) func(*http.Request) {
	t.Helper()
	token, err := s.Issuer.Issue(claims, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return func(r *http.Request) { r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token}) }
}

func TestClientIPTrustsOnlyTheProxysOwnEntry(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "10.0.0.1:1234"
	request.Header.Add("X-Forwarded-For", "1.1.1.1, 2.2.2.2")
	request.Header.Add("X-Forwarded-For", "3.3.3.3, 9.9.9.9")

	if got := (&Server{}).clientIP(request); got != "10.0.0.1" {
		t.Fatalf("without a proxy: %s", got)
	}
	if got := (&Server{TrustedProxy: true}).clientIP(request); got != "9.9.9.9" {
		t.Fatalf("behind a proxy: %s, want the entry it added", got)
	}
	request.Header.Del("X-Forwarded-For")
	if got := (&Server{TrustedProxy: true}).clientIP(request); got != "10.0.0.1" {
		t.Fatalf("no header: %s", got)
	}
}

func connectSrc(policy string) string {
	for _, directive := range strings.Split(policy, "; ") {
		if strings.HasPrefix(directive, "connect-src") {
			return directive
		}
	}
	return ""
}

func TestConnectPolicy(t *testing.T) {
	plain := connectSrc(contentPolicy(policy{Socket: "wss://s2g.example"}))
	if plain != "connect-src 'self' wss://s2g.example" {
		t.Fatalf("got %q", plain)
	}
	direct := connectSrc(contentPolicy(policy{Socket: "wss://s2g.example", DirectMedia: true}))
	if !strings.Contains(direct, " https:") {
		t.Fatalf("hls.js could not load: %q", direct)
	}
	if got := socketOrigin("http://127.0.0.1:18082"); got != "ws://127.0.0.1:18082" {
		t.Fatalf("socket origin = %q", got)
	}
}

func TestNamesWithControlCharactersAreRefused(t *testing.T) {
	s := offlineServer(t)
	response, body := serve(s, http.MethodPatch, "/v1/me", `{"name":"a\u0000b"}`)
	if response.Code != http.StatusBadRequest || body["code"] != "invalid" {
		t.Fatalf("%d %v", response.Code, body)
	}
	if cookie := response.Header().Get("Set-Cookie"); cookie != "" {
		t.Fatalf("a refused name still set a cookie: %s", cookie)
	}
}

func TestPoisonedCookieIsHealed(t *testing.T) {
	s := offlineServer(t)
	_, body := serve(s, http.MethodGet, "/v1/me", "", signedIn(t, s, auth.Claims{Subject: "g_1", Name: "a\x00b"}))
	name, _ := body["user"].(map[string]any)["name"].(string)
	if name == "" || strings.ContainsRune(name, 0) {
		t.Fatalf("name = %q", name)
	}
}

func TestMessagesNeedASession(t *testing.T) {
	response, body := serve(offlineServer(t), http.MethodGet, "/v1/rooms/any/messages", "")
	if response.Code != http.StatusUnauthorized || body["code"] != "unauthorized" {
		t.Fatalf("%d %v", response.Code, body)
	}
}

func TestResolveRouteIsGone(t *testing.T) {
	response, _ := serve(offlineServer(t), http.MethodPost, "/v1/media/resolve", `{"url":"x"}`)
	if response.Code == http.StatusOK {
		t.Fatal("still served")
	}
}

func TestClaimSlugRetriesCollisions(t *testing.T) {
	slugs := []string{"taken", "also-taken", "free"}
	next := func() string {
		slug := slugs[0]
		slugs = slugs[1:]
		return slug
	}
	got, err := claimSlug(next, func(slug string) error {
		if slug != "free" {
			return store.ErrSlugTaken
		}
		return nil
	})
	if err != nil || got != "free" {
		t.Fatalf("got %q, %v", got, err)
	}

	attempts := 0
	_, err = claimSlug(func() string { return "x" }, func(string) error { attempts++; return store.ErrSlugTaken })
	if !errors.Is(err, store.ErrSlugTaken) || attempts != slugAttempts {
		t.Fatalf("err %v after %d attempts", err, attempts)
	}

	failure := errors.New("database down")
	if _, err := claimSlug(func() string { return "x" }, func(string) error { return failure }); !errors.Is(err, failure) {
		t.Fatalf("err = %v", err)
	}
}

func TestUnknownAndClosedRoomsHaveDistinctCodes(t *testing.T) {
	s, pool := stackServer(t)
	if response, body := serve(s, http.MethodGet, "/v1/rooms/no-such-room", ""); response.Code != http.StatusNotFound || body["code"] != "room_not_found" {
		t.Fatalf("%d %v", response.Code, body)
	}
	record := newRoom(t, s, room.New())
	if _, err := pool.Exec(context.Background(), `UPDATE rooms SET closed_at = now() WHERE id = $1`, record.ID); err != nil {
		t.Fatal(err)
	}
	if response, body := serve(s, http.MethodGet, "/v1/rooms/"+record.Slug, ""); response.Code != http.StatusGone || body["code"] != "room_closed" {
		t.Fatalf("%d %v", response.Code, body)
	}
}

func TestPreviewCarriesPlaybackAndCapacity(t *testing.T) {
	s, _ := stackServer(t)

	empty := newRoom(t, s, room.New())
	_, body := serve(s, http.MethodGet, "/v1/rooms/"+empty.Slug, "")
	if playback, present := body["playback"]; !present || playback != nil {
		t.Fatalf("idle room playback = %v", playback)
	}
	if capacity, _ := body["maxMembers"].(float64); capacity <= 0 {
		t.Fatalf("maxMembers = %v", body["maxMembers"])
	}

	now := time.Now().UnixMilli()
	state, _, err := room.Apply(room.New(), room.Actor{ID: "h", Role: room.RoleHost}, room.Command{
		Type: room.CmdQueueAdd, NewItemID: "a", Media: &room.Media{Source: "direct", Title: "a"},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	state.Playback = room.Playback{ItemID: "a", Status: room.StatusPaused, Pos: 192, At: now, Rate: 1}
	playing := newRoom(t, s, state)
	_, body = serve(s, http.MethodGet, "/v1/rooms/"+playing.Slug, "")
	playback, _ := body["playback"].(map[string]any)
	if playback["status"] != room.StatusPaused || playback["pos"] != 192.0 {
		t.Fatalf("playback = %v", body["playback"])
	}
}

func TestSearchIsCappedPerAddress(t *testing.T) {
	s, _ := stackServer(t)
	ip := from("search-" + ids.New())
	for i := range searchesPerHour {
		if response, _ := serve(s, http.MethodGet, "/v1/media/search?q=", "", ip); response.Code != http.StatusOK {
			t.Fatalf("search %d: %d", i, response.Code)
		}
	}
	if response, body := serve(s, http.MethodGet, "/v1/media/search?q=", "", ip); response.Code != http.StatusTooManyRequests {
		t.Fatalf("%d %v", response.Code, body)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/media/search?q=", "", from("search-"+ids.New())); response.Code != http.StatusOK {
		t.Fatal("another address was caught by the same limit")
	}
}

func TestTelemetryIsRateLimited(t *testing.T) {
	s, _ := stackServer(t)
	ip := from("telemetry-" + ids.New())
	for i := range telemetryPerMinute {
		if response, _ := serve(s, http.MethodPost, "/v1/telemetry", `{"events":[]}`, ip); response.Code != http.StatusAccepted {
			t.Fatalf("flush %d: %d", i, response.Code)
		}
	}
	if response, _ := serve(s, http.MethodPost, "/v1/telemetry", `{"events":[]}`, ip); response.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d", response.Code)
	}
}

func TestPreviewOfARoomRedisLostShowsWhereItWillResume(t *testing.T) {
	s, _ := stackServer(t)
	ctx := context.Background()
	owner := "g_" + ids.New()
	if err := s.DB.EnsureUser(ctx, owner, "Owner"); err != nil {
		t.Fatal(err)
	}
	record := store.Room{ID: ids.New(), Slug: ids.Slug(), Name: "Room", OwnerID: owner}
	if err := s.DB.CreateRoom(ctx, record); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	state, _, err := room.Apply(room.New(), room.Actor{ID: "h", Role: room.RoleHost}, room.Command{
		Type: room.CmdQueueAdd, NewItemID: "a", Media: &room.Media{Source: "direct", Title: "a", DurationMS: 600_000},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	state.Playback.At = now - 3_700_000
	if err := s.DB.SaveSnapshot(ctx, record.ID, state); err != nil {
		t.Fatal(err)
	}

	_, body := serve(s, http.MethodGet, "/v1/rooms/"+record.Slug, "")
	playback, _ := body["playback"].(map[string]any)
	if playback["status"] != room.StatusPaused || playback["pos"] != 600.0 {
		t.Fatalf("playback = %v, want paused at 600", body["playback"])
	}
}

func TestOnlyCreatedRoomsCountTowardsTheLimit(t *testing.T) {
	s, _ := stackServer(t)
	ip := "rooms-" + ids.New()
	for range roomsPerHour - 1 {
		if _, err := s.Live.Limit(context.Background(), "rooms:"+ip, roomsPerHour, time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	cookie := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Ada"})

	for range 5 {
		response, body := serve(s, http.MethodPost, "/v1/rooms", `{"url":"https://example.com/nope"}`, cookie, from(ip))
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("rejected link: %d %v", response.Code, body)
		}
	}
	if response, body := serve(s, http.MethodPost, "/v1/rooms", `{}`, cookie, from(ip)); response.Code != http.StatusCreated {
		t.Fatalf("last room of the hour: %d %v", response.Code, body)
	}
	for range 3 {
		if response, body := serve(s, http.MethodPost, "/v1/rooms", `{}`, cookie, from(ip)); response.Code != http.StatusTooManyRequests {
			t.Fatalf("over the limit: %d %v", response.Code, body)
		}
	}
}

func TestTicketRefusesAnEleventhTab(t *testing.T) {
	s, _ := stackServer(t)
	ctx := context.Background()
	record := newRoom(t, s, room.New())
	userID := "g_" + ids.New()
	person := store.Person{UserID: userID, Name: "Tabby", Role: room.RoleMember}
	cookie := signedIn(t, s, auth.Claims{Subject: userID, Name: "Tabby"})

	for i := range hub.MaxSocketsPerUser - 1 {
		if err := s.Live.Touch(ctx, record.ID, fmt.Sprint(i), person); err != nil {
			t.Fatal(err)
		}
	}
	if response, body := serve(s, http.MethodPost, "/v1/rooms/"+record.Slug+"/ticket", "", cookie); response.Code != http.StatusOK {
		t.Fatalf("tenth tab: %d %v", response.Code, body)
	}
	if err := s.Live.Touch(ctx, record.ID, "last", person); err != nil {
		t.Fatal(err)
	}
	response, body := serve(s, http.MethodPost, "/v1/rooms/"+record.Slug+"/ticket", "", cookie)
	if response.Code != http.StatusConflict || body["code"] != "too_many_connections" {
		t.Fatalf("%d %v", response.Code, body)
	}
}

func TestRenameStoresAndReissues(t *testing.T) {
	s, _ := stackServer(t)
	cookie := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Old"})
	response, body := serve(s, http.MethodPatch, "/v1/me", `{"name":"  Maya  "}`, cookie, from("rename-"+ids.New()))
	if response.Code != http.StatusOK {
		t.Fatalf("%d %v", response.Code, body)
	}
	if !bytes.Contains(response.Body.Bytes(), []byte(`"name":"Maya"`)) || response.Header().Get("Set-Cookie") == "" {
		t.Fatalf("%s %v", response.Body, response.Header())
	}
}

func TestANewRoomsVideoSurvivesLosingRedis(t *testing.T) {
	s, _ := stackServer(t)
	s.Catalog = source.NewCatalog(s.DB, 0, s.Log, source.Direct{})
	recorder, body := serve(s, http.MethodPost, "/v1/rooms", `{"url":"https://a.test/a.mp4"}`, from("203.0.113."+ids.New()))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status %d: %v", recorder.Code, body)
	}
	record, err := s.DB.RoomBySlug(context.Background(), body["slug"].(string))
	if err != nil {
		t.Fatal(err)
	}
	state, _, err := s.DB.LoadSnapshot(context.Background(), record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Queue) != 1 {
		t.Fatalf("saved queue = %+v: Redis held the only copy of the video", state.Queue)
	}
}
