package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"stream2gather/internal/config"
	"stream2gather/internal/store"
)

var testLiveKit = config.LiveKit{URL: "ws://lk.test", APIKey: "test-key", APISecret: strings.Repeat("s", 32)}

// voiceRoom creates a room and returns who created it. Nobody is present yet.
func voiceRoom(t *testing.T) (*httptest.Server, *Server, string, store.Room, []*http.Cookie) {
	t.Helper()
	test, server := sessionStack(t)
	server.Voice = testLiveKit
	response, body := call(t, http.MethodPost, test.URL+"/v1/rooms", "", nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", response.StatusCode, body)
	}
	slug, _ := body["slug"].(string)
	record, err := server.DB.RoomBySlug(context.Background(), slug)
	if err != nil {
		t.Fatal(err)
	}
	return test, server, test.URL + "/v1/rooms/" + slug + "/voice-token", record, response.Cookies()
}

func present(t *testing.T, server *Server, roomID, userID, name string) {
	t.Helper()
	if err := server.Live.Touch(context.Background(), roomID, "conn-"+userID, store.Person{UserID: userID, Name: name}); err != nil {
		t.Fatal(err)
	}
}

func TestVoiceTokenIsForPeopleInTheRoom(t *testing.T) {
	test, server, url, record, cookies := voiceRoom(t)
	guest := meOf(t, test, cookies)

	if response, _ := call(t, http.MethodPost, url, "", nil); response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no session: %d", response.StatusCode)
	}
	response, body := call(t, http.MethodPost, url, "", cookies)
	if response.StatusCode != http.StatusForbidden || body["code"] != "not_in_room" {
		t.Fatalf("not present: %d %v", response.StatusCode, body)
	}

	// The room's name for them wins over the one in the cookie, which a rename left behind.
	present(t, server, record.ID, guest["id"].(string), "Renamed")
	before := time.Now()
	response, body = call(t, http.MethodPost, url, "", cookies)
	if response.StatusCode != http.StatusOK || body["url"] != testLiveKit.URL {
		t.Fatalf("present: %d %v", response.StatusCode, body)
	}
	expires := time.UnixMilli(int64(body["expiresAt"].(float64)))
	if life := expires.Sub(before); life < 9*time.Minute || life > 11*time.Minute {
		t.Fatalf("expires in %s", life)
	}

	parts := strings.Split(body["token"].(string), ".")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims struct {
		Subject string `json:"sub"`
		Name    string `json:"name"`
		Video   struct {
			Room string `json:"room"`
		} `json:"video"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	if claims.Subject != guest["id"] || claims.Name != "Renamed" || claims.Video.Room != "s2g-"+record.ID {
		t.Fatalf("claims %+v", claims)
	}
}

func TestVoiceTokenSaysSoWhenVoiceIsOff(t *testing.T) {
	test, server, url, record, cookies := voiceRoom(t)
	present(t, server, record.ID, meOf(t, test, cookies)["id"].(string), "Ada")
	server.Voice = config.LiveKit{}
	response, body := call(t, http.MethodPost, url, "", cookies)
	if response.StatusCode != http.StatusServiceUnavailable || body["code"] != "voice_unavailable" {
		t.Fatalf("got %d %v", response.StatusCode, body)
	}
	if err := server.removeFromVoice(context.Background(), record.ID, "anyone"); err != nil {
		t.Fatalf("removing with voice off: %v", err)
	}
}

func TestVoiceTokensAreLimited(t *testing.T) {
	test, server, url, record, cookies := voiceRoom(t)
	present(t, server, record.ID, meOf(t, test, cookies)["id"].(string), "Ada")
	var last int
	for range voiceTokensPerMinute + 1 {
		response, _ := call(t, http.MethodPost, url, "", cookies)
		last = response.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("got %d", last)
	}
}

func TestRemoveFromVoiceReachesLiveKit(t *testing.T) {
	var path string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.Write([]byte(`{}`))
	}))
	defer fake.Close()
	server := &Server{Voice: config.LiveKit{URL: fake.URL, APIKey: "k", APISecret: testLiveKit.APISecret}}
	if err := server.removeFromVoice(context.Background(), "room1", "user1"); err != nil {
		t.Fatal(err)
	}
	if path != "/twirp/livekit.RoomService/RemoveParticipant" {
		t.Fatalf("path %s", path)
	}
}
