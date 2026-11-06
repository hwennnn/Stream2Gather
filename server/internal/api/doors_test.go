package api

import (
	"net/http"
	"strconv"
	"testing"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
)

func TestAnAddressIsLimitedInTicketsAndToldWhenToComeBack(t *testing.T) {
	s, _ := stackServer(t)
	path := "/v1/rooms/" + newRoom(t, s, room.New()).Slug + "/ticket"
	ip := from("tickets-" + ids.New())

	for i := range ticketsPerMinute {
		if response, body := serve(s, http.MethodPost, path, `{}`, ip); response.Code != http.StatusOK {
			t.Fatalf("ticket %d: %d %v", i, response.Code, body)
		}
	}
	response, body := serve(s, http.MethodPost, path, `{}`, ip)
	if response.Code != http.StatusTooManyRequests || body["code"] != "rate_limited" {
		t.Fatalf("%d %v", response.Code, body)
	}
	wait, err := strconv.Atoi(response.Header().Get("Retry-After"))
	if err != nil || wait < 1 || wait > 61 {
		t.Fatalf("Retry-After = %q", response.Header().Get("Retry-After"))
	}
	if response, _ := serve(s, http.MethodPost, path, `{}`, from("tickets-"+ids.New())); response.Code != http.StatusOK {
		t.Fatal("another address was caught by the same limit")
	}
}

func TestADeadLinkPaysForItsTicketToo(t *testing.T) {
	s, _ := stackServer(t)
	ip := from("tickets-" + ids.New())
	for range ticketsPerMinute {
		serve(s, http.MethodPost, "/v1/rooms/no-such-room/ticket", `{}`, ip)
	}
	if response, _ := serve(s, http.MethodPost, "/v1/rooms/no-such-room/ticket", `{}`, ip); response.Code != http.StatusTooManyRequests {
		t.Fatalf("%d", response.Code)
	}
}
