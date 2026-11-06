package voice

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"stream2gather/internal/config"
)

const testSecret = "a-test-secret-that-is-long-enough-for-livekit"

func testClient(url string) *Client {
	client := New(config.LiveKit{URL: url, APIKey: "test-key", APISecret: testSecret})
	client.now = func() time.Time { return time.Unix(1_800_000_000, 0) }
	return client
}

// payloadOf checks the signature and returns the claims as JSON.
func payloadOf(t *testing.T, token string) string {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d parts", len(parts))
	}
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil)); parts[2] != want {
		t.Fatalf("signature %s, want %s", parts[2], want)
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || string(header) != `{"alg":"HS256","typ":"JWT"}` {
		t.Fatalf("header %s, %v", header, err)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	return string(payload)
}

func TestTokenLetsOnePersonUseOneRoomsMicrophone(t *testing.T) {
	token, expires, err := testClient("ws://lk.test").Token("room1", "user1", "Hana")
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"iss":"test-key","sub":"user1","name":"Hana","nbf":1800000000,"exp":1800000600,` +
		`"video":{"roomJoin":true,"room":"s2g-room1","canPublish":true,"canPublishData":false,` +
		`"canPublishSources":["microphone"],"canSubscribe":true}}`
	if got := payloadOf(t, token); got != want {
		t.Fatalf("claims\n got %s\nwant %s", got, want)
	}
	if got := expires.Sub(time.Unix(1_800_000_000, 0)); got != 10*time.Minute {
		t.Fatalf("lives for %s", got)
	}
}

func TestRemoveCallsLiveKitAsAnAdminOfThatRoom(t *testing.T) {
	var path, body, authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, authorization = r.URL.Path, r.Header.Get("Authorization")
		read, _ := io.ReadAll(r.Body)
		body = string(read)
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	// The socket address is what's configured; LiveKit's HTTP API is on the same port.
	address := "ws://" + strings.TrimPrefix(server.URL, "http://")
	if err := testClient(address).Remove(context.Background(), "room1", "user1"); err != nil {
		t.Fatal(err)
	}
	if path != "/twirp/livekit.RoomService/RemoveParticipant" {
		t.Fatalf("path %s", path)
	}
	if body != `{"identity":"user1","room":"s2g-room1"}` {
		t.Fatalf("body %s", body)
	}
	var got claims
	if err := json.Unmarshal([]byte(payloadOf(t, strings.TrimPrefix(authorization, "Bearer "))), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Video.RoomAdmin || got.Video.Room != "s2g-room1" || got.Video.RoomJoin || got.Subject != "" {
		t.Fatalf("grant %+v", got)
	}
}

func TestRemovingSomeoneNotInTheCallIsFine(t *testing.T) {
	for status, wantErr := range map[int]bool{http.StatusNotFound: false, http.StatusUnauthorized: true, http.StatusInternalServerError: true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		}))
		err := testClient(server.URL).Remove(context.Background(), "room1", "user1")
		server.Close()
		if (err != nil) != wantErr {
			t.Errorf("%d: error %v", status, err)
		}
	}
}

func TestHTTPAddress(t *testing.T) {
	for in, want := range map[string]string{
		"wss://lk.test":        "https://lk.test",
		"ws://127.0.0.1:17880": "http://127.0.0.1:17880",
		"https://lk.test":      "https://lk.test",
	} {
		if got := httpAddress(in); got != want {
			t.Errorf("%s: got %s", in, got)
		}
	}
}
