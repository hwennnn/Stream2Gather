package api

import (
	"context"
	"net/http"
	"time"

	"stream2gather/internal/voice"
)

// Reconnects and tab switches ask again, so this only stops a runaway client.
const voiceTokensPerMinute = 30

// voiceRoutes adds the voice routes.
func (s *Server) voiceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/rooms/{slug}/voice-token", s.voiceToken)
}

// voiceToken lets someone already in a room into its call. The name on the token
// is the one the room shows, which a rename may have moved past the cookie's.
func (s *Server) voiceToken(w http.ResponseWriter, r *http.Request) {
	if !s.Voice.Enabled() {
		writeProblem(w, http.StatusServiceUnavailable, "voice_unavailable", "Voice isn't available.")
		return
	}
	claims, ok, err := s.session(r)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "unauthorized", "Join the room to use voice.")
		return
	}
	record, ok := s.findRoom(w, r)
	if !ok {
		return
	}
	// Presence lingers after a socket closes, so being listed doesn't mean being allowed.
	if _, ok := s.crewEntry(w, r, record, claims); !ok {
		return
	}
	allowed, err := s.Live.Limit(r.Context(), "voice:"+claims.Subject, voiceTokensPerMinute, time.Minute)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Slow down a little.")
		return
	}
	people, err := s.Live.People(r.Context(), record.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	for _, person := range people {
		if person.UserID != claims.Subject {
			continue
		}
		token, expires, err := voice.New(s.Voice).Token(record.ID, person.UserID, person.Name)
		if err != nil {
			s.internal(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"url": s.Voice.URL, "token": token, "expiresAt": expires.UnixMilli()})
		return
	}
	writeProblem(w, http.StatusForbidden, "not_in_room", "Join the room to use voice.")
}

// removeFromVoice drops someone from a room's call, for a crew removal. With no
// voice server there is no call to drop them from.
func (s *Server) removeFromVoice(ctx context.Context, roomID, userID string) error {
	if !s.Voice.Enabled() {
		return nil
	}
	return voice.New(s.Voice).Remove(ctx, roomID, userID)
}
