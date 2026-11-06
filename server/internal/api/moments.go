package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

const (
	momentsPerPage = 500
	// momentsPerMinute is a live room's reaction rate, for one person.
	momentsPerMinute = 120
	maxBodyRunes     = 500
	endOfTime        = int64(1) << 62
)

// crewItem says what a catch-up link points at. Media is null when it can't play.
func (s *Server) crewItem(w http.ResponseWriter, r *http.Request) {
	_, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	itemID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "not_found", "That video isn't here.")
		return
	}
	source, sourceID, err := s.DB.CrewItem(r.Context(), crew.ID, itemID)
	if errors.Is(err, store.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "not_found", "That video isn't here.")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	fresh, err := s.DB.FreshMedia(r.Context(), []room.Item{{Media: room.Media{Source: source, SourceID: sourceID}}})
	if err != nil {
		s.internal(w, err)
		return
	}
	reply := map[string]any{"source": source, "sourceId": sourceID, "crewName": crew.Name, "media": nil}
	if len(fresh) == 1 && !fresh[0].IsLive {
		reply["media"] = fresh[0]
	}
	writeJSON(w, http.StatusOK, reply)
}

func queryInt(r *http.Request, name string, fallback int64) (int64, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	return value, err == nil && value >= 0
}

// moments reads a video's reactions and chat, a page at a time. `after` is the
// `next` of the page before.
func (s *Server) moments(w http.ResponseWriter, r *http.Request) {
	_, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	from, fromOK := queryInt(r, "from", 0)
	to, toOK := queryInt(r, "to", endOfTime)
	span := store.MomentRange{FromMs: from, ToMs: to, AfterPos: -1, Limit: momentsPerPage}
	validAfter := true
	if after := query.Get("after"); after != "" {
		_, err := fmt.Sscanf(after, "%d:%d", &span.AfterPos, &span.AfterID)
		validAfter = err == nil
	}
	if !fromOK || !toOK || !validAfter || query.Get("source") == "" || query.Get("id") == "" {
		writeProblem(w, http.StatusBadRequest, "bad_request", "That isn't a range of a video.")
		return
	}
	items, err := s.DB.VideoMoments(r.Context(), crew.ID, query.Get("source"), query.Get("id"), span)
	if err != nil {
		s.internal(w, err)
		return
	}
	reply := map[string]any{"items": items}
	if len(items) == momentsPerPage {
		last := items[len(items)-1]
		reply["next"] = fmt.Sprintf("%d:%d", last.PosMs, last.ID)
	}
	writeJSON(w, http.StatusOK, reply)
}

func cleanBody(body string) (string, bool) {
	body = strings.TrimSpace(body)
	if body == "" || len([]rune(body)) > maxBodyRunes || strings.ContainsFunc(body, unicode.IsControl) {
		return "", false
	}
	return body, true
}

// addMoment keeps a reaction or line from someone watching later, for the next person.
func (s *Server) addMoment(w http.ResponseWriter, r *http.Request) {
	claims, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	var request struct {
		Source string `json:"source"`
		ID     string `json:"id"`
		PosMs  int64  `json:"posMs"`
		Emoji  string `json:"emoji"`
		Body   string `json:"body"`
	}
	if !decode(w, r, &request) {
		return
	}
	body, bodyOK := cleanBody(request.Body)
	if request.PosMs < 0 || (request.Emoji != "") == (request.Body != "") ||
		(request.Emoji != "" && !room.Reactions[request.Emoji]) || (request.Body != "" && !bodyOK) {
		writeProblem(w, http.StatusBadRequest, "bad_moment", "That can't be added.")
		return
	}
	allowed, err := s.Live.Limit(r.Context(), "moments:"+claims.Subject, momentsPerMinute, time.Minute)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Slow down a little.")
		return
	}
	watched, err := s.DB.CrewWatched(r.Context(), crew.ID, request.Source, request.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !watched {
		writeProblem(w, http.StatusNotFound, "not_found", "This crew hasn't watched that.")
		return
	}
	id, err := s.DB.AddCatchupMoment(r.Context(), store.CatchupMoment{
		CrewID: crew.ID, RoomID: crew.RoomID, Source: request.Source, SourceID: request.ID, PosMs: request.PosMs,
		UserID: claims.Subject, Author: claims.Name, Emoji: request.Emoji, Body: body,
	})
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}
