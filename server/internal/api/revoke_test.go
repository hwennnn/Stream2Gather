package api

import (
	"context"
	"net/http"
	"testing"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
)

func TestATicketCarriesTheSessionItCameFrom(t *testing.T) {
	s, _ := stackServer(t)
	ctx := context.Background()
	record := newRoom(t, s, room.New())
	user := "u_" + ids.New()
	if err := s.DB.EnsureUser(ctx, user, "Ada"); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.BumpSessionVersion(ctx, user); err != nil {
		t.Fatal(err)
	}

	cookie := signedIn(t, s, auth.Claims{Subject: user, Name: "Ada", Account: true, Version: 1})
	recorder, body := serve(s, http.MethodPost, "/v1/rooms/"+record.Slug+"/ticket", "{}", cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status %d, %v", recorder.Code, body)
	}
	ticket, found, err := s.Live.TakeTicket(ctx, body["ticket"].(string))
	if err != nil || !found {
		t.Fatalf("ticket: %v %v", found, err)
	}
	if !ticket.Account || ticket.SessionVersion != 1 {
		t.Fatalf("ticket = %+v: its socket could never be matched to a sign-out", ticket)
	}
}
