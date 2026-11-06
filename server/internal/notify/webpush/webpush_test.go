package webpush

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// open does what the browser does, without sharing any code with encrypt.
func (b browser) open(t *testing.T, body []byte) []byte {
	t.Helper()
	salt, size := body[:16], binary.BigEndian.Uint32(body[16:20])
	keyEnd := 21 + int(body[20])
	if size != recordSize {
		t.Fatalf("record size %d", size)
	}
	sender, err := ecdh.P256().NewPublicKey(body[21:keyEnd])
	if err != nil {
		t.Fatal(err)
	}
	shared, err := b.key.ECDH(sender)
	if err != nil {
		t.Fatal(err)
	}
	info := "WebPush: info\x00" + string(b.key.PublicKey().Bytes()) + string(sender.Bytes())
	input, _ := hkdf.Key(sha256.New, shared, b.secret, info, 32)
	cek, _ := hkdf.Key(sha256.New, input, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, input, salt, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, body[keyEnd:], nil)
	if err != nil {
		t.Fatal(err)
	}
	if plain[len(plain)-1] != lastRecord {
		t.Fatalf("no end of record: %x", plain[len(plain)-1])
	}
	return plain[:len(plain)-1]
}

func newSender(t *testing.T) (*Sender, string) {
	t.Helper()
	public, private, err := GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	sender, err := New(public, private, "mailto:push@stream2gather.test")
	if err != nil {
		t.Fatal(err)
	}
	return sender, public
}

func TestSendReachesTheBrowserWithTheHeadersPushServicesWant(t *testing.T) {
	sender, public := newSender(t)
	phone, to := newBrowser(t)
	var seen *http.Request
	var body []byte
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer service.Close()

	to.Endpoint = service.URL + "/send/abc"
	message := Message{Title: "Hana started watching in Movie Night", Body: "Join in", Navigate: "/r/movie"}
	if err := sender.Send(context.Background(), to, "crew-with-a-long-id-well-past-thirty-two-characters", message); err != nil {
		t.Fatal(err)
	}

	for header, want := range map[string]string{"TTL": "300", "Urgency": "high", "Content-Encoding": "aes128gcm"} {
		if got := seen.Header.Get(header); got != want {
			t.Errorf("%s = %q", header, got)
		}
	}
	if topic := seen.Header.Get("Topic"); len(topic) != 32 || strings.Contains(topic, "crew") {
		t.Errorf("topic %q", topic)
	}
	checkJWT(t, seen.Header.Get("Authorization"), public, service.URL)
	want := `{"web_push":8030,"notification":{"title":"Hana started watching in Movie Night","body":"Join in","navigate":"/r/movie"}}`
	if got := string(phone.open(t, body)); got != want {
		t.Fatalf("browser read %s", got)
	}
}

func TestWhatAPushServiceAnswersDecidesWhatHappensNext(t *testing.T) {
	sender, _ := newSender(t)
	_, to := newBrowser(t)
	cases := []struct {
		status     int
		retryAfter string
		gone       bool
		retry      bool
		after      time.Duration
	}{
		{status: 201},
		{status: 404, gone: true},
		{status: 410, gone: true},
		{status: 429, retryAfter: "120", retry: true, after: 2 * time.Minute},
		{status: 503, retry: true},
		{status: 403},
	}
	for _, c := range cases {
		service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			if c.retryAfter != "" {
				w.Header().Set("Retry-After", c.retryAfter)
			}
			w.WriteHeader(c.status)
		}))
		to.Endpoint = service.URL
		err := sender.Send(context.Background(), to, "crew", Message{})
		service.Close()

		var retry *RetryError
		if got := errors.Is(err, ErrGone); got != c.gone {
			t.Errorf("%d: gone = %v (%v)", c.status, got, err)
		}
		if got := errors.As(err, &retry); got != c.retry || (got && retry.After != c.after) {
			t.Errorf("%d: retry = %v (%v)", c.status, got, err)
		}
		if c.status == 403 && err == nil {
			t.Error("403 passed as sent")
		}
	}
}

func TestARedirectIsNotFollowed(t *testing.T) {
	sender, _ := newSender(t)
	_, to := newBrowser(t)
	followed := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { followed = true }))
	defer target.Close()
	service := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusTemporaryRedirect))
	defer service.Close()
	to.Endpoint = service.URL
	if err := sender.Send(context.Background(), to, "crew", Message{}); err == nil || followed {
		t.Fatalf("err = %v, followed = %v", err, followed)
	}
}
