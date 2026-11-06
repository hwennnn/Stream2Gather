package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// crewRoutes adds the crew routes. Track A owns this file.
func (s *Server) crewRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/crews", s.createCrew)
	mux.HandleFunc("GET /v1/crews/{slug}", s.crewHome)
	mux.HandleFunc("PATCH /v1/crews/{slug}", s.updateCrew)
	mux.HandleFunc("DELETE /v1/crews/{slug}", s.closeCrew)
	mux.HandleFunc("POST /v1/crews/{slug}/join", s.joinCrew)
	mux.HandleFunc("POST /v1/crews/{slug}/invite", s.rotateInvite)
	mux.HandleFunc("PATCH /v1/crews/{slug}/me", s.setCrewNotify)
	mux.HandleFunc("POST /v1/rooms/{slug}/crew", s.promoteRoom)
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

// crewPrivate reports whether a room is closed to this person, who may be nobody.
func crewPrivate(access store.CrewAccess) bool {
	return access.Exists && !access.Member && !access.GuestAccess
}

// crewEntry runs before a ticket is issued. It reports whether this person is on
// the crew, and false in ok after writing the refusal for a members-only room.
func (s *Server) crewEntry(w http.ResponseWriter, r *http.Request, record store.Room, claims auth.Claims) (member, ok bool) {
	access, err := s.DB.CrewAccessOf(r.Context(), record.ID, claims.Subject)
	if err != nil {
		s.internal(w, err)
		return false, false
	}
	if crewPrivate(access) {
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

// findCrew loads the crew at this address. Callers decide what this caller may see.
func (s *Server) findCrew(w http.ResponseWriter, r *http.Request) (store.Room, store.Crew, bool) {
	record, ok := s.findRoom(w, r)
	if !ok {
		return store.Room{}, store.Crew{}, false
	}
	crew, err := s.DB.CrewOfRoom(r.Context(), record)
	if errors.Is(err, store.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "crew_not_found", "This room has no crew.")
		return store.Room{}, store.Crew{}, false
	}
	if err != nil {
		s.internal(w, err)
		return store.Room{}, store.Crew{}, false
	}
	return record, crew, true
}

// publishCrew tells everyone in the room to fetch the crew again. The change has
// already been made, so failing to say so is not worth failing the request.
func (s *Server) publishCrew(ctx context.Context, roomID, changed string) {
	event, _ := json.Marshal(map[string]any{"t": "crew", "d": map[string]string{"changed": changed}})
	if err := s.Live.Publish(context.WithoutCancel(ctx), roomID, event); err != nil {
		s.Log.Warn("crew event not sent", "room", roomID, "error", err)
	}
}

func (s *Server) crewFailed(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrCrewLimit):
		writeProblem(w, http.StatusConflict, "crew_limit", "You can have up to 10 crews.")
	case errors.Is(err, store.ErrCrewFull):
		writeProblem(w, http.StatusConflict, "crew_full", "This crew is full.")
	case errors.Is(err, store.ErrInvalidInvite):
		writeProblem(w, http.StatusForbidden, "invalid_invite", "This invite link has expired. Ask for a new one.")
	case errors.Is(err, store.ErrRoomClosed):
		writeProblem(w, http.StatusGone, "room_closed", "This room has closed.")
	case errors.Is(err, store.ErrNotMember):
		writeProblem(w, http.StatusConflict, "not_member", "That person isn't on this crew.")
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

// ownedCrew is findCrew for routes only the owner may use.
func (s *Server) ownedCrew(w http.ResponseWriter, r *http.Request) (store.Crew, bool) {
	claims, ok := s.account(w, r)
	if !ok {
		return store.Crew{}, false
	}
	_, crew, ok := s.findCrew(w, r)
	if !ok {
		return store.Crew{}, false
	}
	if crew.OwnerID != claims.Subject {
		writeProblem(w, http.StatusForbidden, "forbidden", "Only the crew's owner can do that.")
		return store.Crew{}, false
	}
	return crew, true
}

func (s *Server) updateCrew(w http.ResponseWriter, r *http.Request) {
	crew, ok := s.ownedCrew(w, r)
	if !ok {
		return
	}
	var request struct {
		Name        *string `json:"name"`
		GuestAccess *bool   `json:"guestAccess"`
		OwnerID     *string `json:"ownerId"`
	}
	if !decode(w, r, &request) {
		return
	}
	if request.Name != nil {
		name, valid := room.CleanName(*request.Name)
		if !valid {
			writeProblem(w, http.StatusBadRequest, "invalid", "Crew names can be up to 32 characters.")
			return
		}
		request.Name = &name
	}
	change := store.CrewChange{Name: request.Name, GuestAccess: request.GuestAccess, OwnerID: request.OwnerID}
	if err := s.DB.UpdateCrew(r.Context(), crew, change); err != nil {
		s.crewFailed(w, err)
		return
	}
	s.publishCrew(r.Context(), crew.RoomID, "settings")
	writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
}

// closeCrew ends the room for good. Anyone still in it finds out from their next
// fetch, which says the room has closed.
func (s *Server) closeCrew(w http.ResponseWriter, r *http.Request) {
	crew, ok := s.ownedCrew(w, r)
	if !ok {
		return
	}
	if err := s.DB.CloseCrew(r.Context(), crew); err != nil {
		s.internal(w, err)
		return
	}
	s.publishCrew(r.Context(), crew.RoomID, "settings")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) rotateInvite(w http.ResponseWriter, r *http.Request) {
	crew, ok := s.ownedCrew(w, r)
	if !ok {
		return
	}
	token := ids.New()
	if err := s.DB.RotateInvite(r.Context(), crew.ID, token); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"inviteToken": token})
}

func (s *Server) setCrewNotify(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	var request struct {
		Notify string `json:"notify"`
	}
	if !decode(w, r, &request) {
		return
	}
	if request.Notify != "all" && request.Notify != "off" {
		writeProblem(w, http.StatusBadRequest, "invalid", "That setting isn't available.")
		return
	}
	_, crew, ok := s.findCrew(w, r)
	if !ok {
		return
	}
	if err := s.DB.SetCrewNotify(r.Context(), crew.ID, claims.Subject, request.Notify); err != nil {
		s.crewFailed(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"notify": request.Notify})
}

// promoteRoom is "Keep this room": the link and everyone's connection stay put.
func (s *Server) promoteRoom(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	record, ok := s.findRoom(w, r)
	if !ok {
		return
	}
	if record.OwnerID != claims.Subject {
		writeProblem(w, http.StatusForbidden, "forbidden", "Only the room's owner can keep it.")
		return
	}
	err := s.DB.PromoteRoom(r.Context(), record, store.Crew{ID: ids.New(), InviteToken: ids.New()})
	if err != nil {
		s.crewFailed(w, err)
		return
	}
	crew, err := s.DB.CrewOfRoom(r.Context(), record)
	if err != nil {
		s.internal(w, err)
		return
	}
	s.publishCrew(r.Context(), record.ID, "settings")
	writeJSON(w, http.StatusOK, map[string]string{"slug": record.Slug, "name": record.Name, "inviteToken": crew.InviteToken})
}

func (s *Server) joinCrew(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	var request struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &request) {
		return
	}
	record, crew, ok := s.findCrew(w, r)
	if !ok {
		return
	}
	if err := s.DB.JoinCrew(r.Context(), crew.ID, claims.Subject, request.Token); err != nil {
		s.crewFailed(w, err)
		return
	}
	s.publishCrew(r.Context(), record.ID, "members")
	writeJSON(w, http.StatusOK, map[string]bool{"joined": true})
}

// crewDocument is the crew home. Who is here and what is playing come from the
// live room, so nothing from a video's source is stored for it.
type crewDocument struct {
	preview
	OwnerID     string             `json:"ownerId"`
	InviteToken string             `json:"inviteToken"`
	GuestAccess bool               `json:"guestAccess"`
	Roster      []store.CrewMember `json:"roster"`
}

func (s *Server) crewHome(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	record, crew, ok := s.findCrew(w, r)
	if !ok {
		return
	}
	roster, err := s.DB.CrewRoster(r.Context(), crew.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !slices.ContainsFunc(roster, func(m store.CrewMember) bool { return m.UserID == claims.Subject }) {
		writeProblem(w, http.StatusForbidden, "not_member", "Join the crew to see this.")
		return
	}
	live, err := s.buildPreview(r.Context(), record)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, crewDocument{
		preview: live, OwnerID: record.OwnerID, InviteToken: crew.InviteToken, GuestAccess: crew.GuestAccess, Roster: roster,
	})
}
