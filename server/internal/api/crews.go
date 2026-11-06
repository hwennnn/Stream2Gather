package api

import (
	"errors"
	"net/http"
	"time"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// crewRoutes adds the crew routes. Track A owns this file.
func (s *Server) crewRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/crews", s.createCrew)
}

// crewSummary is what GET /v1/rooms/{slug} says about a room's crew.
type crewSummary struct {
	MemberCount int  `json:"memberCount"`
	IsMember    bool `json:"isMember"`
	GuestAccess bool `json:"guestAccess"`
}

// crewPreview returns nil for a room with no crew.
func (s *Server) crewPreview(r *http.Request, record store.Room) (*crewSummary, error) {
	claims, _, _ := s.session(r) // Unchecked means not a member, which only hides the crew's own details.
	access, err := s.DB.CrewAccessOf(r.Context(), record.ID, claims.Subject)
	if err != nil || !access.Exists {
		return nil, err
	}
	return &crewSummary{MemberCount: access.MemberCount, IsMember: access.Member, GuestAccess: access.GuestAccess}, nil
}

// crewEntry runs before a ticket is issued. It reports whether this person is on
// the crew, and false in ok after writing the refusal for a members-only room.
func (s *Server) crewEntry(w http.ResponseWriter, r *http.Request, record store.Room, claims auth.Claims) (member, ok bool) {
	access, err := s.DB.CrewAccessOf(r.Context(), record.ID, claims.Subject)
	if err != nil {
		s.internal(w, err)
		return false, false
	}
	if access.Exists && !access.Member && !access.GuestAccess {
		writeProblem(w, http.StatusForbidden, "members_only", "This room is for its crew.")
		return false, false
	}
	return access.Member, true
}

// roomMessages is the room's chat as this caller may see it.
func (s *Server) roomMessages(r *http.Request, record store.Room, before int64, limit int) ([]store.Message, error) {
	return s.DB.Messages(r.Context(), record.ID, before, limit)
}

// account is the signed-in caller. Crews are the one thing guests can't hold.
func (s *Server) account(w http.ResponseWriter, r *http.Request) (auth.Claims, bool) {
	claims, ok, err := s.session(r)
	if err != nil {
		s.sessionFailed(w, err)
		return auth.Claims{}, false
	}
	if !ok || !claims.Account {
		writeProblem(w, http.StatusUnauthorized, "sign_in", "Sign in to do that.")
		return auth.Claims{}, false
	}
	return claims, true
}

func (s *Server) crewFailed(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrCrewLimit):
		writeProblem(w, http.StatusConflict, "crew_limit", "You can have up to 10 crews.")
	default:
		s.internal(w, err)
	}
}

func (s *Server) createCrew(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &request) {
		return
	}
	name, valid := room.CleanName(request.Name)
	if !valid {
		writeProblem(w, http.StatusBadRequest, "invalid", "Crew names can be up to 32 characters.")
		return
	}
	allowed, err := s.Live.Limit(r.Context(), "rooms:"+s.clientIP(r), roomsPerHour, time.Hour)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many new rooms. Try again later.")
		return
	}

	record := store.Room{ID: ids.New(), Name: name, OwnerID: claims.Subject}
	crew := store.Crew{ID: ids.New(), InviteToken: ids.New()}
	record.Slug, err = claimSlug(ids.Slug, func(slug string) error {
		record.Slug = slug
		return s.DB.CreateCrew(r.Context(), record, crew)
	})
	if err != nil {
		s.crewFailed(w, err)
		return
	}
	if err := s.Live.Seed(r.Context(), record.ID, room.New()); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"slug": record.Slug, "name": name, "inviteToken": crew.InviteToken})
}
