package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"stream2gather/internal/notify/webpush"
	"stream2gather/internal/store"
)

const (
	// A browser subscribes once, so this only stops a runaway client.
	pushSavesPerMinute = 10
	maxUserAgent       = 200
	// Real ones are a few hundred characters. Much past this, the unique index refuses.
	maxEndpoint = 2000
)

// pushRoutes adds the web push routes. serve only writes these rows: the notifier
// sends, and holds the private key.
func (s *Server) pushRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/push/subscriptions", s.savePushSubscription)
	mux.HandleFunc("DELETE /v1/push/subscriptions/{id}", s.deletePushSubscription)
	mux.HandleFunc("GET /v1/me/notifications", s.myNotifications)
}

func (s *Server) savePushSubscription(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	var request struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !decode(w, r, &request) {
		return
	}
	subscription := webpush.Subscription{Endpoint: request.Endpoint, P256dh: request.Keys.P256dh, Auth: request.Keys.Auth}
	if len(subscription.Endpoint) > maxEndpoint || !webpush.Allowed(subscription.Endpoint, !s.Secure) || !subscription.Valid() {
		writeProblem(w, http.StatusBadRequest, "invalid", "This browser's push details can't be used.")
		return
	}
	allowed, err := s.Live.Limit(r.Context(), "push:"+claims.Subject, pushSavesPerMinute, time.Minute)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Slow down a little.")
		return
	}
	userAgent := r.UserAgent()
	if len(userAgent) > maxUserAgent {
		userAgent = userAgent[:maxUserAgent]
	}
	userAgent = strings.ToValidUTF8(userAgent, "") // Postgres refuses half a character.
	id, err := s.DB.SavePushSubscription(r.Context(), claims.Subject, subscription.Endpoint, subscription.P256dh, subscription.Auth, userAgent)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) deletePushSubscription(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	err := s.DB.DeletePushSubscription(r.Context(), claims.Subject, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "not_found", "That device is already gone.")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) myNotifications(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.account(w, r)
	if !ok {
		return
	}
	devices, err := s.DB.PushDevices(r.Context(), claims.Subject)
	if err != nil {
		s.internal(w, err)
		return
	}
	crews, err := s.DB.PushCrews(r.Context(), claims.Subject)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": devices, "crews": crews})
}
