package notify

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"stream2gather/internal/notify/webpush"
	"stream2gather/internal/store"
)

type fakeDevices struct {
	mu      sync.Mutex
	targets []store.PushTarget
	dropped []string
	ok      []string
}

func (f *fakeDevices) PushTargets(context.Context, string) ([]store.PushTarget, error) {
	return f.targets, nil
}

func (f *fakeDevices) DropPushTarget(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.dropped = append(f.dropped, id)
	return nil
}

func (f *fakeDevices) MarkPushOK(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ok = append(f.ok, id)
	return nil
}

func answering(t *testing.T, status int) string {
	t.Helper()
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
	t.Cleanup(service.Close)
	return service.URL
}

func device(t *testing.T, id, endpoint string) store.PushTarget {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	return store.PushTarget{ID: id, Endpoint: endpoint, P256dh: encode(key.PublicKey().Bytes()), Auth: encode(make([]byte, 16))}
}

func pushWith(t *testing.T, devices *fakeDevices) *Push {
	t.Helper()
	public, private, err := webpush.GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	sender, err := webpush.New(public, private, "mailto:push@stream2gather.test")
	if err != nil {
		t.Fatal(err)
	}
	return &Push{Devices: devices, Sender: sender, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

func TestADeadDeviceIsDroppedAndTheLiveOneStillGetsIt(t *testing.T) {
	devices := &fakeDevices{targets: []store.PushTarget{
		device(t, "dead", answering(t, http.StatusGone)),
		device(t, "live", answering(t, http.StatusCreated)),
	}}
	reached, err := pushWith(t, devices).Reach(context.Background(), "bo", "crew", webpush.Message{})
	if err != nil || !reached {
		t.Fatalf("reached = %v, err = %v", reached, err)
	}
	if len(devices.dropped) != 1 || devices.dropped[0] != "dead" || len(devices.ok) != 1 || devices.ok[0] != "live" {
		t.Fatalf("dropped %v, ok %v", devices.dropped, devices.ok)
	}
}

func TestABusyServiceAsksForARetryOnlyWhenNothingGotThrough(t *testing.T) {
	devices := &fakeDevices{targets: []store.PushTarget{device(t, "busy", answering(t, http.StatusTooManyRequests))}}
	reached, err := pushWith(t, devices).Reach(context.Background(), "bo", "crew", webpush.Message{})
	var retry *webpush.RetryError
	if reached || !errors.As(err, &retry) {
		t.Fatalf("reached = %v, err = %v", reached, err)
	}
	if len(devices.dropped) != 0 {
		t.Fatalf("a busy device was dropped: %v", devices.dropped)
	}
}

func TestARefusalIsNotRetried(t *testing.T) {
	devices := &fakeDevices{targets: []store.PushTarget{device(t, "refused", answering(t, http.StatusForbidden))}}
	reached, err := pushWith(t, devices).Reach(context.Background(), "bo", "crew", webpush.Message{})
	if reached || err != nil {
		t.Fatalf("reached = %v, err = %v", reached, err)
	}
}
