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
	return `{"claim":true,"endpoint":"` + endpoint + `","keys":{"p256dh":"` + key + `","auth":"` + auth + `"}}`
}

// reloadBody is what a page load sends, with nobody having agreed to anything.
func reloadBody(endpoint, key, auth string) string {
	return strings.Replace(subscribeBody(endpoint, key, auth), `"claim":true,`, "", 1)
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

// A lost laptop is signed out from another device. Its lock screen shouldn't go on
// naming the crew and who's watching.
func TestOpeningACrewHomeNeverTakesABrowserFromAnyone(t *testing.T) {
	s, pool := stackServer(t)
	hanaID, hana := signUp(t, s, "Hana")
	boID, bo := signUp(t, s, "Bo")
	endpoint := pushEndpoint()
	key, auth := browserKeys(t)
	holder := func() (id string) {
		t.Helper()
		if err := pool.QueryRow(context.Background(), `SELECT user_id FROM push_subscriptions WHERE endpoint = $1`, endpoint).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}

	if response, body := serve(s, http.MethodPost, "/v1/push/subscriptions", reloadBody(endpoint, key, auth), hana); response.Code != http.StatusConflict || body["code"] != "not_yours" {
		t.Fatalf("a page load saved a browser nobody allowed: %d %v", response.Code, body)
	}
	if response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(endpoint, key, auth), hana); response.Code != http.StatusCreated {
		t.Fatalf("allow: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", reloadBody(endpoint, key, auth), hana); response.Code != http.StatusCreated {
		t.Fatalf("the holder's page load: %d", response.Code)
	}

	if response, body := serve(s, http.MethodPost, "/v1/push/subscriptions", reloadBody(endpoint, key, auth), bo); response.Code != http.StatusConflict || body["code"] != "not_yours" {
		t.Fatalf("someone else's page load: %d %v", response.Code, body)
	}
	if holder() != hanaID.Subject {
		t.Fatal("a page load moved the browser to the next person")
	}
	if response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(endpoint, key, auth), bo); response.Code != http.StatusCreated {
		t.Fatalf("allow by the next person: %d", response.Code)
	}
	if holder() != boID.Subject {
		t.Fatal("pressing Allow did not take the browser")
	}
}

func TestSigningOutStopsEveryDevicesPings(t *testing.T) {
	s, pool := stackServer(t)
	account, hana := signUp(t, s, "Hana")
	key, auth := browserKeys(t)
	for range 2 {
		response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(pushEndpoint(), key, auth), hana)
		if response.Code != http.StatusCreated {
			t.Fatalf("subscribe: %d %s", response.Code, response.Body)
		}
	}

	serve(s, http.MethodDelete, "/v1/session", "", hana)

	var left int
	err := pool.QueryRow(context.Background(), `SELECT count(*) FROM push_subscriptions WHERE user_id = $1`, account.Subject).Scan(&left)
	if err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("%d devices still get pings for someone signed out", left)
	}
}

func TestALongUserAgentIsCutOnACharacter(t *testing.T) {
	s, _ := stackServer(t)
	_, hana := signUp(t, s, "Hana")
	key, auth := browserKeys(t)
	browser := func(r *http.Request) {
		hana(r)
		r.Header.Set("User-Agent", "x"+strings.Repeat("界", maxUserAgent))
	}
	response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(pushEndpoint(), key, auth), browser)
	if response.Code != http.StatusCreated {
		t.Fatalf("subscribe: %d %s", response.Code, response.Body)
	}
}

// Past what its unique index can hold, Postgres answers with an error, not a row.
func TestAnEndpointTooLongToStoreIsRefused(t *testing.T) {
	s, _ := stackServer(t)
	_, hana := signUp(t, s, "Hana")
	key, auth := browserKeys(t)
	endpoint := pushEndpoint()
	for len(endpoint) < 8000 {
		endpoint += ids.New()
	}
	response, _ := serve(s, http.MethodPost, "/v1/push/subscriptions", subscribeBody(endpoint, key, auth), hana)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", response.Code, response.Body)
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
