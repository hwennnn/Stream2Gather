// Package voice mints LiveKit tokens and removes people from calls. It signs and
// calls LiveKit by hand because its Go SDK would add 30% to the binary.
package voice

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"stream2gather/internal/config"
)

// TokenTTL only limits joining: LiveKit refreshes tokens for people in a call.
const TokenTTL = 10 * time.Minute

const (
	adminTTL    = time.Minute
	callTimeout = 5 * time.Second
)

var httpClient = &http.Client{Timeout: callTimeout}

// Client signs for one LiveKit server.
type Client struct {
	server config.LiveKit
	now    func() time.Time
}

// New returns a client for this server.
func New(server config.LiveKit) *Client {
	return &Client{server: server, now: time.Now}
}

// RoomName is LiveKit's name for a room's call.
func RoomName(roomID string) string { return "s2g-" + roomID }

// grant is LiveKit's `video` claim. A missing canPublishData means true, so
// turning data off has to be said.
type grant struct {
	RoomJoin          bool     `json:"roomJoin,omitempty"`
	RoomAdmin         bool     `json:"roomAdmin,omitempty"`
	Room              string   `json:"room"`
	CanPublish        *bool    `json:"canPublish,omitempty"`
	CanPublishData    *bool    `json:"canPublishData,omitempty"`
	CanPublishSources []string `json:"canPublishSources,omitempty"`
	CanSubscribe      *bool    `json:"canSubscribe,omitempty"`
}

type claims struct {
	Issuer    string `json:"iss"`
	Subject   string `json:"sub,omitempty"`
	Name      string `json:"name,omitempty"`
	NotBefore int64  `json:"nbf"`
	Expires   int64  `json:"exp"`
	Video     grant  `json:"video"`
}

// Token lets one person hear a room's call, and speak in it with a microphone
// and nothing else.
func (c *Client) Token(roomID, userID, name string) (string, time.Time, error) {
	yes, no := true, false
	now := c.now()
	expires := now.Add(TokenTTL)
	token, err := c.sign(claims{
		Issuer:    c.server.APIKey,
		Subject:   userID,
		Name:      name,
		NotBefore: now.Unix(),
		Expires:   expires.Unix(),
		Video: grant{
			RoomJoin:          true,
			Room:              RoomName(roomID),
			CanPublish:        &yes,
			CanPublishData:    &no,
			CanPublishSources: []string{"microphone"},
			CanSubscribe:      &yes,
		},
	})
	return token, expires, err
}

func (c *Client) sign(payload claims) (string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding
	unsigned := encoded.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`)) + "." + encoded.EncodeToString(body)
	mac := hmac.New(sha256.New, []byte(c.server.APISecret))
	mac.Write([]byte(unsigned))
	return unsigned + "." + encoded.EncodeToString(mac.Sum(nil)), nil
}

// Remove takes someone out of a call. It is the only way to end a call early, as
// tokens can't be revoked. Someone who isn't in the call counts as removed.
func (c *Client) Remove(ctx context.Context, roomID, userID string) error {
	name := RoomName(roomID)
	status, reply, err := c.call(ctx, name, "RemoveParticipant", map[string]string{"room": name, "identity": userID})
	if err != nil {
		return err
	}
	if status == http.StatusOK || status == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("livekit: remove participant: %d %s", status, reply)
}

// call posts to LiveKit's RoomService, which speaks Twirp over plain JSON.
func (c *Client) call(ctx context.Context, room, method string, body any) (int, []byte, error) {
	now := c.now()
	token, err := c.sign(claims{
		Issuer:    c.server.APIKey,
		NotBefore: now.Unix(),
		Expires:   now.Add(adminTTL).Unix(),
		Video:     grant{RoomAdmin: true, Room: room},
	})
	if err != nil {
		return 0, nil, err
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	url := httpAddress(c.server.URL) + "/twirp/livekit.RoomService/" + method
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	reply, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	return response.StatusCode, reply, err
}

func httpAddress(url string) string {
	if rest, ok := strings.CutPrefix(url, "wss://"); ok {
		return "https://" + rest
	}
	if rest, ok := strings.CutPrefix(url, "ws://"); ok {
		return "http://" + rest
	}
	return url
}
