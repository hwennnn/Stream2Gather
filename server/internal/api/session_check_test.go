package api

import (
	"net/http"
	"testing"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
)

// accountWithBrokenDatabase is a genuine signed-in cookie on a server whose
// database has stopped answering. Nothing can say whether it was signed out.
func accountWithBrokenDatabase(t *testing.T) (*Server, func(*http.Request)) {
	t.Helper()
	s, pool := stackServer(t)
	cookie := signedIn(t, s, auth.Claims{Subject: "u_" + ids.New(), Name: "Ada", Account: true, Version: 1})
	pool.Close()
	return s, cookie
}

func TestAnUncheckableSessionIsNotTrusted(t *testing.T) {
	s, cookie := accountWithBrokenDatabase(t)
	recorder, body := serve(s, http.MethodGet, "/v1/me", "", cookie)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, %v: a cookie that may have been signed out was believed", recorder.Code, body)
	}
}

func TestAnUncheckableSessionIsNotReplacedWithAGuest(t *testing.T) {
	s, cookie := accountWithBrokenDatabase(t)
	recorder, _ := serve(s, http.MethodPatch, "/v1/me", `{"name":"Grace"}`, cookie, from("session-"+ids.New()))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", recorder.Code)
	}
	if set := recorder.Result().Cookies(); len(set) != 0 {
		t.Fatalf("set %v: a blip must not sign someone out", set)
	}
}

func TestSignOutSaysSoWhenOtherDevicesStayedIn(t *testing.T) {
	s, cookie := accountWithBrokenDatabase(t)
	recorder, _ := serve(s, http.MethodDelete, "/v1/session", "", cookie)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status %d: reporting success would leave every other device signed in", recorder.Code)
	}
	if set := recorder.Result().Cookies(); len(set) != 1 || set[0].MaxAge >= 0 {
		t.Fatalf("this browser's cookie stayed: %v", set)
	}
}

func TestAGuestNeedsNoDatabaseToBeBelieved(t *testing.T) {
	s, pool := stackServer(t)
	cookie := signedIn(t, s, auth.Claims{Subject: "g_" + ids.New(), Name: "Ada"})
	pool.Close()
	if recorder, _ := serve(s, http.MethodGet, "/v1/me", "", cookie); recorder.Code != http.StatusOK {
		t.Fatalf("status %d", recorder.Code)
	}
}
