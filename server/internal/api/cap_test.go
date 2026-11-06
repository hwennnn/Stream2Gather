package api

import (
	"context"
	"net/http"
	"testing"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

func fullRoom(t *testing.T, s *Server) store.Room {
	t.Helper()
	record := newRoom(t, s, room.New())
	for range 50 {
		if err := s.Live.Touch(context.Background(), record.ID, ids.New(), store.Person{UserID: "g_" + ids.New()}); err != nil {
			t.Fatal(err)
		}
	}
	return record
}

func TestAFullRoomStillLetsItsOwnerIn(t *testing.T) {
	s, _ := stackServer(t)
	record := fullRoom(t, s)
	cookie := signedIn(t, s, auth.Claims{Subject: record.OwnerID, Name: "Owner"})
	if recorder, body := serve(s, http.MethodPost, "/v1/rooms/"+record.Slug+"/ticket", "{}", cookie); recorder.Code != http.StatusOK {
		t.Fatalf("status %d, %v", recorder.Code, body)
	}
}

func TestAFullRoomTurnsAStrangerAway(t *testing.T) {
	s, _ := stackServer(t)
	record := fullRoom(t, s)
	recorder, body := serve(s, http.MethodPost, "/v1/rooms/"+record.Slug+"/ticket", "{}", from("cap-"+ids.New()))
	if recorder.Code != http.StatusConflict || body["code"] != "room_full" {
		t.Fatalf("status %d, %v", recorder.Code, body)
	}
}
