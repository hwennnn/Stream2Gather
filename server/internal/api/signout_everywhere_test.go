package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"stream2gather/internal/auth"
)

// clerkOnTwoDevices is what the app can't see from its cookies: Clerk keeps a
// device signed in, and goes on issuing it tokens, until its session is ended.
type clerkOnTwoDevices struct {
	fakeClerk
	ended   []string
	failure error
}

func (c *clerkOnTwoDevices) Verify(ctx context.Context, token string) (auth.Identity, error) {
	if len(c.ended) > 0 {
		return auth.Identity{}, auth.ErrInvalidToken
	}
	return c.fakeClerk.Verify(ctx, token)
}

func (c *clerkOnTwoDevices) EndSessions(_ context.Context, clerkID string) error {
	if c.failure != nil {
		return c.failure
	}
	c.ended = append(c.ended, clerkID)
	return nil
}

func TestSigningOutStopsAnotherDeviceClickingBackIn(t *testing.T) {
	test, server := sessionStack(t)
	clerk := &clerkOnTwoDevices{fakeClerk: server.Clerk.(fakeClerk)}
	server.Clerk = clerk
	laptop := signInAs(t, test, "good", nil)
	phone := signInAs(t, test, "good", nil)

	call(t, http.MethodDelete, test.URL+"/v1/session", "", laptop)
	if user := meOf(t, test, phone); user != nil {
		t.Fatalf("the phone's cookie survived: %v", user)
	}

	// "Sign in" on the phone: Clerk loads, still signed in, and asks for no password.
	response, body := call(t, http.MethodPost, test.URL+"/v1/session/clerk", "good", phone)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d %v: one click undid the sign-out, and now /v1/me says %v",
			response.StatusCode, body, meOf(t, test, merged(phone, response.Cookies())))
	}
	if len(clerk.ended) != 1 || clerk.ended[0] != clerk.identity.ClerkID {
		t.Fatalf("ended %v, want the signed-out person's Clerk id", clerk.ended)
	}
}

func TestSignOutSaysSoWhenClerkKeptTheOtherDevices(t *testing.T) {
	test, server := sessionStack(t)
	server.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	clerk := &clerkOnTwoDevices{fakeClerk: server.Clerk.(fakeClerk), failure: errors.New("clerk is down")}
	server.Clerk = clerk
	cookies := signInAs(t, test, "good", nil)

	response, _ := call(t, http.MethodDelete, test.URL+"/v1/session", "", cookies)
	if response.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status %d: reporting success would leave other devices one click from back in", response.StatusCode)
	}
	if user := meOf(t, test, cookies); user != nil {
		t.Fatalf("this cookie must die even so: %v", user)
	}
}

func TestAGuestSigningOutAsksNothingOfClerk(t *testing.T) {
	test, server := sessionStack(t)
	clerk := &clerkOnTwoDevices{fakeClerk: server.Clerk.(fakeClerk)}
	server.Clerk = clerk
	response, body := call(t, http.MethodPost, test.URL+"/v1/rooms", "", nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", response.StatusCode, body)
	}

	call(t, http.MethodDelete, test.URL+"/v1/session", "", response.Cookies())
	if len(clerk.ended) != 0 {
		t.Fatalf("ended %v for a guest", clerk.ended)
	}
}
