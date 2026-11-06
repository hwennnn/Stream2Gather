package api

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stream2gather/internal/ids"
)

// browserKeys makes what a browser would send. Nothing here reads them back.
func browserKeys(t *testing.T) (key, auth string) {
	t.Helper()
	private, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	return encode(private.PublicKey().Bytes()), encode(make([]byte, 16))
}

func subscribeBody(endpoint, key, auth string) string {
	return `{"endpoint":"` + endpoint + `","keys":{"p256dh":"` + key + `","auth":"` + auth + `"}}`
}

func pushEndpoint() string { return "https://fcm.googleapis.com/fcm/send/" + ids.New() }

func TestABrowserSubscribesOnceAndCanBeRemoved(t *testing.T) {
	s, pool := stackServer(t)
	_, hana := signUp(t, s, "Hana")
	endpoint := pushEndpoint()
	key, auth := browserKeys(t)

	response, first := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(endpoint, key, auth), hana)
	if response.Code != http.StatusCreated {
		t.Fatalf("subscribe: %d %s", response.Code, response.Body)
	}
	_, again := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(endpoint, key, auth), hana)
	if again["id"] != first["id"] {
		t.Fatalf("a second subscribe made another device: %v", again)
	}

	response, body := serve(s, http.MethodGet, "/v1/me/notifications", "", hana)
	devices := body["devices"].([]any)
	if response.Code != http.StatusOK || len(devices) != 1 {
		t.Fatalf("devices: %d %s", response.Code, response.Body)
	}
	if strings.Contains(response.Body.String(), endpoint) || strings.Contains(response.Body.String(), key) {
		t.Fatalf("the page was sent a device's keys: %s", response.Body)
	}

	id := first["id"].(string)
	_, stranger := signUp(t, s, "Stranger")
	if response, _ := serve(s, http.MethodDelete, "/v1/push/subscriptions/"+id, "", stranger); response.Code != http.StatusNotFound {
		t.Fatalf("a stranger's delete: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodDelete, "/v1/push/subscriptions/"+id, "", hana); response.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", response.Code)
	}
	var left int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM push_subscriptions WHERE endpoint = $1`, endpoint).Scan(&left); err != nil || left != 0 {
		t.Fatalf("left = %d, err = %v", left, err)
	}
}

func TestOnlyAPushServiceAndRealKeysAreStored(t *testing.T) {
	s, _ := stackServer(t)
	s.Secure = true
	_, hana := signUp(t, s, "Hana")
	key, auth := browserKeys(t)
	for name, body := range map[string]string{
		"our own network": subscribeBody("http://169.254.169.254/latest/meta-data", key, auth),
		"a local server":  subscribeBody("http://127.0.0.1:18090/healthz", key, auth),
		"bad keys":        subscribeBody(pushEndpoint(), base64.RawURLEncoding.EncodeToString([]byte("not a point")), auth),
	} {
		if response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", body, hana); response.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, response.Code)
		}
	}
}

func TestGuestsHaveNoPushDevices(t *testing.T) {
	s, _ := stackServer(t)
	key, auth := browserKeys(t)
	if response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(pushEndpoint(), key, auth)); response.Code != http.StatusUnauthorized {
		t.Fatalf("subscribe: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/me/notifications", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("list: %d", response.Code)
	}
}

func TestCrewSettingsComeBackWithDevices(t *testing.T) {
	s, _ := stackServer(t)
	_, hana := signUp(t, s, "Hana")
	slug, _ := newCrew(t, s, hana)
	if response, _ := serve(s, http.MethodPatch, "/v1/crews/"+slug+"/me", `{"notify":"off"}`, hana); response.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", response.Code, response.Body)
	}
	_, body := serve(s, http.MethodGet, "/v1/me/notifications", "", hana)
	crews := body["crews"].([]any)
	if len(crews) != 1 || crews[0].(map[string]any)["notify"] != "off" || crews[0].(map[string]any)["slug"] != slug {
		t.Fatalf("crews: %v", crews)
	}
}

func TestTheWorkerAndManifestAreServedAsBrowsersNeed(t *testing.T) {
	s := offlineServer(t)
	s.WebDir = t.TempDir()
	for name, text := range map[string]string{"sw.js": "self", "manifest.webmanifest": "{}"} {
		if err := os.WriteFile(filepath.Join(s.WebDir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	get := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		s.static(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder
	}
	if got := get("/sw.js").Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("sw.js cache = %q", got)
	}
	if got := get("/manifest.webmanifest").Header().Get("Content-Type"); got != "application/manifest+json" {
		t.Errorf("manifest type = %q", got)
	}
}
