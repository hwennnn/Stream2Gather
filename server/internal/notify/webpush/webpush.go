package webpush

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

const (
	ttlSeconds = 300
	// A browser refuses more than 4 KB, and only one record is ever sent.
	maxPayload = 3800
	timeout    = 10 * time.Second
)

// ErrGone means the browser dropped this subscription, so delete it.
var ErrGone = errors.New("subscription is gone")

// RetryError means the push service wants this sent again later.
type RetryError struct {
	Status int
	// After is what the service asked for, and zero when it didn't say.
	After time.Duration
}

func (e *RetryError) Error() string {
	return fmt.Sprintf("push service answered %d, retry after %s", e.Status, e.After)
}

// Message is what a person sees. No video title goes here: that keeps spoilers
// off lock screens and source data away from push services.
type Message struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Navigate string `json:"navigate"`
}

// Sender delivers messages signed with one VAPID key.
type Sender struct {
	vapid  *vapid
	client *http.Client
}

// New builds a Sender from base64url VAPID keys.
func New(publicKey, privateKey, subject string) (*Sender, error) {
	keys, err := newVAPID(publicKey, privateKey, subject)
	if err != nil {
		return nil, err
	}
	return &Sender{vapid: keys, client: &http.Client{
		Timeout: timeout,
		// An endpoint was checked when stored. A redirect would go somewhere that wasn't.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

// payload is Declarative Web Push: Safari shows it without running sw.js, and
// sw.js reads the same fields everywhere else.
func payload(message Message) ([]byte, error) {
	return json.Marshal(struct {
		Magic        int     `json:"web_push"`
		Notification Message `json:"notification"`
	}{8030, message})
}

// Send pushes to one browser. A newer message on the same topic replaces this one
// while it waits, so topic is hashed: the service sees neither the crew nor over
// the 32 characters it allows.
func (s *Sender) Send(ctx context.Context, to Subscription, topic string, message Message) error {
	plain, err := payload(message)
	if err != nil {
		return err
	}
	if len(plain) > maxPayload {
		return fmt.Errorf("message is %d bytes", len(plain))
	}
	body, err := encrypt(plain, to)
	if err != nil {
		return err
	}
	authorization, err := s.vapid.header(to.Endpoint, time.Now())
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, to.Endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(topic))
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Encoding", "aes128gcm")
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("TTL", strconv.Itoa(ttlSeconds))
	request.Header.Set("Topic", hex.EncodeToString(sum[:16]))
	request.Header.Set("Urgency", "high")

	response, err := s.client.Do(request)
	if err != nil {
		return &RetryError{}
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	return outcome(response, time.Now())
}

func outcome(response *http.Response, now time.Time) error {
	status := response.StatusCode
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusNotFound || status == http.StatusGone:
		return ErrGone
	case status == http.StatusTooManyRequests || status >= 500:
		return &RetryError{Status: status, After: retryAfter(response.Header.Get("Retry-After"), now)}
	}
	return fmt.Errorf("push service refused the message: %d", status)
}

func retryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil && at.After(now) {
		return at.Sub(now)
	}
	return 0
}
