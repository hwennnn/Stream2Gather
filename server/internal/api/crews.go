package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"stream2gather/internal/auth"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
)

const (
	// A person lining up a whole evening is well inside this.
	watchlistAddsPerHour = 120
	// mediaFreshFor is the 30-day limit on keeping a source's data.
	mediaFreshFor = 30 * 24 * time.Hour
)

// crewRoutes adds the crew routes. Track A owns this file.
func (s *Server) crewRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/crews", s.createCrew)
	mux.HandleFunc("GET /v1/crews/{slug}", s.crewHome)
	mux.HandleFunc("PATCH /v1/crews/{slug}", s.updateCrew)
	mux.HandleFunc("DELETE /v1/crews/{slug}", s.closeCrew)
	mux.HandleFunc("POST /v1/crews/{slug}/join", s.joinCrew)
	mux.HandleFunc("POST /v1/crews/{slug}/invite", s.rotateInvite)
	mux.HandleFunc("DELETE /v1/crews/{slug}/members/{userId}", s.removeMember)
	mux.HandleFunc("GET /v1/crews/{slug}/watchlist", s.watchlist)
	mux.HandleFunc("POST /v1/crews/{slug}/watchlist", s.addWatch)
	mux.HandleFunc("DELETE /v1/crews/{slug}/watchlist/{id}", s.removeWatch)
	mux.HandleFunc("GET /v1/me/crews", s.myCrews)
	mux.HandleFunc("DELETE /v1/me", s.deleteMe)
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

// crewEvent says what changed about a room's crew. Clients refetch; the hub also
// reads userId, to keep that person's presence true.
type crewEvent struct {
	Changed string `json:"changed"`
	UserID  string `json:"userId,omitempty"`
	Member  bool   `json:"member,omitempty"`
	// Kick closes this person's sockets, for a room they can no longer enter.
	Kick bool `json:"kick,omitempty"`
	// MembersOnly closes the room to the guests already in it.
	MembersOnly bool `json:"membersOnly,omitempty"`
	// Host moves the host's role on sockets already open, after a handover.
	Host string `json:"host,omitempty"`
	// Invite goes to those present when a room becomes a crew, who hold no link that can join it.
	Invite string `json:"invite,omitempty"`
}

// publishCrew tells the room. The change has already been made, so failing to say
// so is not worth failing the request.
func (s *Server) publishCrew(ctx context.Context, roomID string, event crewEvent) {
	body, _ := json.Marshal(map[string]any{"t": "crew", "d": event})
	if err := s.Live.Publish(context.WithoutCancel(ctx), roomID, body); err != nil {
		s.Log.Warn("crew event not sent", "room", roomID, "error", err)
	}
}

var errOwnerStays = errors.New("the owner can't leave")

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
	case errors.Is(err, store.ErrWatchlistFull):
		writeProblem(w, http.StatusConflict, "watchlist_full", "The watchlist is full.")
	case errors.Is(err, errOwnerStays):
		writeProblem(w, http.StatusConflict, "owner_stays", "Hand the crew to someone else first.")
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
	locked := request.GuestAccess != nil && !*request.GuestAccess
	host := ""
	if request.OwnerID != nil && *request.OwnerID != crew.OwnerID {
		host = *request.OwnerID
	}
	s.publishCrew(r.Context(), crew.RoomID, crewEvent{Changed: "settings", MembersOnly: locked, Host: host})
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
	s.publishCrew(r.Context(), crew.RoomID, crewEvent{Changed: "settings"})
	writeJSON(w, http.StatusOK, map[string]bool{"done": true})
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

// removeMember is leaving, or the owner removing someone. A removal retires the
// invite too, and ends their call and, in a members-only room, their visit.
func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	_, crew, ok := s.findCrew(w, r)
	if !ok {
		return
	}
	target := r.PathValue("userId")
	if target != claims.Subject && crew.OwnerID != claims.Subject {
		writeProblem(w, http.StatusForbidden, "forbidden", "Only the crew's owner can do that.")
		return
	}
	if target == crew.OwnerID {
		s.crewFailed(w, errOwnerStays)
		return
	}
	token := ""
	if target != claims.Subject {
		token = ids.New()
	}
	removed, err := s.DB.RemoveMember(r.Context(), crew.ID, target, token)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !removed {
		s.crewFailed(w, store.ErrNotMember)
		return
	}
	if token != "" {
		if err := s.removeFromVoice(r.Context(), crew.RoomID, target); err != nil {
			s.Log.Warn("voice removal failed", "room", crew.RoomID, "error", err)
		}
	}
	s.publishCrew(r.Context(), crew.RoomID, crewEvent{Changed: "members", UserID: target, Kick: !crew.GuestAccess})
	writeJSON(w, http.StatusOK, map[string]bool{"done": true})
}

// memberCrew is findCrew for routes only people on the roster may use. Guests in
// the room are not: they can watch, but the crew's list is the crew's.
func (s *Server) memberCrew(w http.ResponseWriter, r *http.Request) (auth.Claims, store.Crew, bool) {
	claims, ok := s.account(w, r)
	if !ok {
		return auth.Claims{}, store.Crew{}, false
	}
	record, crew, ok := s.findCrew(w, r)
	if !ok {
		return auth.Claims{}, store.Crew{}, false
	}
	access, err := s.DB.CrewAccessOf(r.Context(), record.ID, claims.Subject)
	if err != nil {
		s.internal(w, err)
		return auth.Claims{}, store.Crew{}, false
	}
	if !access.Member {
		writeProblem(w, http.StatusForbidden, "not_member", "Join the crew to see this.")
		return auth.Claims{}, store.Crew{}, false
	}
	return claims, crew, true
}

func (s *Server) watchlist(w http.ResponseWriter, r *http.Request) {
	_, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	items, err := s.DB.Watchlist(r.Context(), crew.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// addWatch goes through the catalog like queue.add, so clients only ever name a
// video. A link can cost a source lookup, and that is what the limit is for.
func (s *Server) addWatch(w http.ResponseWriter, r *http.Request) {
	claims, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	var request struct {
		URL      string `json:"url"`
		Source   string `json:"source"`
		SourceID string `json:"sourceId"`
	}
	if !decode(w, r, &request) {
		return
	}
	allowed, err := s.Live.Limit(r.Context(), "watchlist:"+claims.Subject, watchlistAddsPerHour, time.Hour)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many videos at once. Try again later.")
		return
	}
	videoSource, sourceID := request.Source, request.SourceID
	if request.URL != "" {
		media, err := s.Catalog.Resolve(r.Context(), request.URL, source.LookupCharge(s.Live.Limit, s.clientIP(r)))
		if err != nil {
			s.mediaFailed(w, err)
			return
		}
		videoSource, sourceID = media.Source, media.SourceID
	} else if _, found, err := s.DB.GetMedia(r.Context(), videoSource, sourceID, mediaFreshFor); err != nil {
		s.internal(w, err)
		return
	} else if !found {
		writeProblem(w, http.StatusUnprocessableEntity, "media", "That video could not be loaded.")
		return
	}
	if err := s.DB.AddWatch(r.Context(), crew.ID, videoSource, sourceID, claims.Subject); err != nil {
		s.crewFailed(w, err)
		return
	}
	s.publishCrew(r.Context(), crew.RoomID, crewEvent{Changed: "watchlist"})
	writeJSON(w, http.StatusOK, map[string]bool{"done": true})
}

func (s *Server) removeWatch(w http.ResponseWriter, r *http.Request) {
	_, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	removed, err := s.DB.RemoveWatch(r.Context(), crew.ID, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !removed {
		writeProblem(w, http.StatusNotFound, "not_found", "That video isn't on the list.")
		return
	}
	s.publishCrew(r.Context(), crew.RoomID, crewEvent{Changed: "watchlist"})
	writeJSON(w, http.StatusOK, map[string]bool{"done": true})
}

// myCrews feeds the rail. Who is here comes live from each room, so one room's
// Redis read failing costs its count and nothing else.
func (s *Server) myCrews(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	crews, err := s.DB.CrewsOf(r.Context(), claims.Subject)
	if err != nil {
		s.internal(w, err)
		return
	}
	type line struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
		Here int    `json:"here"`
	}
	items := make([]line, len(crews))
	for i, crew := range crews {
		people, err := s.Live.People(r.Context(), crew.RoomID)
		if err != nil {
			s.Log.Warn("crew presence failed", "room", crew.RoomID, "error", err)
		}
		items[i] = line{Slug: crew.Slug, Name: crew.Name, Here: len(people)}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// deleteMe removes the account now rather than on a schedule, and signs out.
func (s *Server) deleteMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	rooms, err := s.DB.DeleteAccount(r.Context(), claims.Subject)
	if err != nil {
		s.internal(w, err)
		return
	}
	s.versions.forget(claims.Subject)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteLaxMode,
	})
	for _, roomID := range rooms {
		s.publishCrew(r.Context(), roomID, crewEvent{Changed: "settings"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": nil})
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
	s.publishCrew(r.Context(), record.ID, crewEvent{Changed: "settings", UserID: claims.Subject, Member: true, Invite: crew.InviteToken})
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
	s.publishCrew(r.Context(), record.ID, crewEvent{Changed: "members", UserID: claims.Subject, Member: true})
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
	Watchlist   []store.WatchItem  `json:"watchlist"`
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
	watchlist, err := s.DB.Watchlist(r.Context(), crew.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, crewDocument{
		preview: live, OwnerID: record.OwnerID, InviteToken: crew.InviteToken, GuestAccess: crew.GuestAccess,
		Roster: roster, Watchlist: watchlist,
	})
}
