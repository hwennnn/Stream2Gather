//go:build livekit

package voice

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/coder/websocket"

	"stream2gather/internal/config"
)

// These run against a real LiveKit: make voice, then
// LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... go test -tags livekit ./internal/voice
func realClient(t *testing.T) *Client {
	t.Helper()
	server := config.LiveKit{
		URL:       os.Getenv("LIVEKIT_URL"),
		APIKey:    os.Getenv("LIVEKIT_API_KEY"),
		APISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
	if !server.Enabled() {
		t.Fatal("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required")
	}
	return New(server)
}

// join holds a signal connection, which is all LiveKit needs to list someone.
func join(ctx context.Context, t *testing.T, c *Client, roomID, userID string) *websocket.Conn {
	t.Helper()
	token, _, err := c.Token(roomID, userID, "Test")
	if err != nil {
		t.Fatal(err)
	}
	ws, response, err := websocket.Dial(ctx, c.server.URL+"/rtc?protocol=16&access_token="+token, nil)
	if err != nil {
		t.Fatalf("LiveKit refused the token: %v (%+v)", err, response)
	}
	t.Cleanup(func() { _ = ws.CloseNow() })
	ws.SetReadLimit(1 << 20)
	if _, _, err := ws.Read(ctx); err != nil {
		t.Fatalf("no join response: %v", err)
	}
	return ws
}

func participants(ctx context.Context, t *testing.T, c *Client, roomID string) []string {
	t.Helper()
	name := RoomName(roomID)
	status, reply, err := c.call(ctx, name, "ListParticipants", map[string]string{"room": name})
	if err != nil || status != http.StatusOK {
		t.Fatalf("list: %d %s %v", status, reply, err)
	}
	var list struct {
		Participants []struct {
			Identity string `json:"identity"`
		} `json:"participants"`
	}
	if err := json.Unmarshal(reply, &list); err != nil {
		t.Fatal(err)
	}
	identities := make([]string, len(list.Participants))
	for i, person := range list.Participants {
		identities[i] = person.Identity
	}
	return identities
}

func TestLiveKitAcceptsTokensAndRemovesPeople(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client := realClient(t)
	roomID := "integration-" + time.Now().Format("150405.000")

	stays := join(ctx, t, client, roomID, "stays")
	removed := join(ctx, t, client, roomID, "removed")
	defer stays.CloseNow()

	got := participants(ctx, t, client, roomID)
	if !slices.Contains(got, "stays") || !slices.Contains(got, "removed") {
		t.Fatalf("participants %v", got)
	}
	if err := client.Remove(ctx, roomID, "removed"); err != nil {
		t.Fatal(err)
	}
	if got := participants(ctx, t, client, roomID); slices.Contains(got, "removed") || !slices.Contains(got, "stays") {
		t.Fatalf("after removal: %v", got)
	}
	// Their socket hears it and then closes, which is what ends their call.
	for {
		if _, _, err := removed.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("the removed socket stayed open")
			}
			break
		}
	}

	if err := client.Remove(ctx, roomID, "removed"); err != nil {
		t.Fatalf("removing them twice: %v", err)
	}
	if err := client.Remove(ctx, "no-such-room", "anyone"); err != nil {
		t.Fatalf("removing from an empty call: %v", err)
	}
}

func TestLiveKitRefusesABadSignature(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := realClient(t)
	forged := New(config.LiveKit{URL: client.server.URL, APIKey: client.server.APIKey, APISecret: "not-the-secret-not-the-secret-not-the-secret"})
	token, _, err := forged.Token("forged", "mallory", "Mallory")
	if err != nil {
		t.Fatal(err)
	}
	if ws, _, err := websocket.Dial(ctx, client.server.URL+"/rtc?protocol=16&access_token="+token, nil); err == nil {
		_ = ws.CloseNow()
		t.Fatal("a forged token was accepted")
	}
}
