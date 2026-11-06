package api

import (
	"net/http"

	"stream2gather/internal/auth"
	"stream2gather/internal/store"
)

// crewRoutes adds the crew routes. Track A owns this file.
func (s *Server) crewRoutes(*http.ServeMux) {}

// crewSummary is what GET /v1/rooms/{slug} says about a room's crew.
type crewSummary struct {
	MemberCount int  `json:"memberCount"`
	IsMember    bool `json:"isMember"`
	GuestAccess bool `json:"guestAccess"`
}

// crewPreview returns nil for a room with no crew.
func (s *Server) crewPreview(*http.Request, store.Room) (*crewSummary, error) {
	return nil, nil
}

// crewEntry runs before a ticket is issued. It reports whether this person is on
// the crew, and false in ok after writing the refusal for a members-only room.
func (s *Server) crewEntry(http.ResponseWriter, *http.Request, store.Room, auth.Claims) (member, ok bool) {
	return false, true
}

// roomMessages is the room's chat as this caller may see it.
func (s *Server) roomMessages(r *http.Request, record store.Room, before int64, limit int) ([]store.Message, error) {
	return s.DB.Messages(r.Context(), record.ID, before, limit)
}
