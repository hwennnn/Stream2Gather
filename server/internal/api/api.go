// Package api serves the HTTP routes.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stream2gather/internal/auth"
	"stream2gather/internal/config"
	"stream2gather/internal/hub"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
	"stream2gather/internal/telemetry"
)

const (
	sessionCookie = "s2g_session"
	sessionTTL    = 90 * 24 * time.Hour
	maxBodyBytes  = 64 << 10
	// requestTimeout bounds what a stuck Redis or Postgres can hold open. It stays
	// under the client's wait, so an answer comes back rather than a silence.
	requestTimeout = 12 * time.Second
	// High enough for a watch party behind one campus or office address.
	guestsPerHour = 600
	// Each search can spend YouTube quota the whole site shares.
	searchesPerHour = 20
	// ticketsPerMinute leaves a full room behind one address room to reconnect
	// at once after a restart, with a second room's worth to spare.
	ticketsPerMinute = 120
	searchMaxQuery   = 200
	// Tabs flush every ten seconds. This leaves room for a shared address.
	telemetryPerMinute = 240
	// Counts rooms that exist, so a mistyped link costs nothing here. What a link
	// costs to look up is charged separately, by source.LookupCharge.
	roomsPerHour = 120
	slugAttempts = 5
)

// ClerkVerifier turns a Clerk session token into the person it belongs to.
type ClerkVerifier interface {
	Verify(ctx context.Context, token string) (auth.Identity, error)
}

// Server holds what the routes need.
type Server struct {
	DB           *store.Postgres
	Live         *store.Live
	Pool         *pgxpool.Pool
	Redis        *redis.Client
	Hub          *hub.Hub
	Catalog      *source.Catalog
	Issuer       *auth.Issuer
	Sink         *telemetry.Sink
	Log          *slog.Logger
	PublicOrigin string
	WebDir       string
	Secure       bool
	// DirectMedia means viewers may play media from any https host.
	DirectMedia bool
	// TrustedProxy means one proxy in front of this server sets X-Forwarded-For.
	TrustedProxy bool
	// Clerk is nil when sign-in is not configured; guests still work.
	Clerk               ClerkVerifier
	ClerkPublishableKey string
	// Voice is the zero value when LiveKit is not configured.
	Voice          config.LiveKit
	VAPIDPublicKey string
	// Vimeo and Twitch open the content policy to those players.
	Vimeo, Twitch bool
	TwitchParent  string

	assets   sync.Map
	versions sessionVersions
	// requestTimeout is here so that tests need not wait it out.
	requestTimeout time.Duration
}

// Handler returns the route table.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /v1/config", s.config)
	mux.HandleFunc("GET /v1/me", s.me)
	mux.HandleFunc("PATCH /v1/me", s.rename)
	mux.HandleFunc("POST /v1/session/clerk", s.clerkSession)
	mux.HandleFunc("DELETE /v1/session", s.endSession)
	mux.HandleFunc("POST /v1/rooms", s.createRoom)
	mux.HandleFunc("GET /v1/rooms/{slug}", s.roomPreview)
	mux.HandleFunc("POST /v1/rooms/{slug}/ticket", s.ticket)
	mux.HandleFunc("GET /v1/rooms/{slug}/messages", s.messages)
	mux.HandleFunc("GET /v1/media/search", s.search)
	mux.HandleFunc("GET /v1/media/trending", s.trending)
	mux.HandleFunc("POST /v1/telemetry", s.telemetry)
	mux.HandleFunc("GET /v1/ws", s.socket)
	mux.HandleFunc("GET /r/{slug}", s.roomPage)
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { s.pageWithCard(w, r, siteCard) })
	mux.HandleFunc("GET /", s.static)
	s.crewRoutes(mux)
	s.voiceRoutes(mux)
	s.pushRoutes(mux)
	timeout := s.requestTimeout
	if timeout == 0 {
		timeout = requestTimeout
	}
	return securityHeaders(namedHost(s.PublicOrigin, withDeadline(mux, timeout)), contentPolicy(policy{
		ClerkHost:   auth.ClerkHost(s.ClerkPublishableKey),
		Socket:      socketOrigin(s.PublicOrigin),
		DirectMedia: s.DirectMedia,
		Voice:       s.Voice.Origins(),
		Vimeo:       s.Vimeo,
		Twitch:      s.Twitch,
	}))
}

// socketOrigin is the page's own origin as a WebSocket address. Not every
// browser takes 'self' to cover it.
func socketOrigin(public string) string {
	if rest, ok := strings.CutPrefix(public, "https://"); ok {
		return "wss://" + rest
	}
	if rest, ok := strings.CutPrefix(public, "http://"); ok {
		return "ws://" + rest
	}
	return ""
}

// policy is what the page may reach beyond itself and YouTube.
type policy struct {
	ClerkHost   string
	Socket      string
	DirectMedia bool
	// Voice is LiveKit's addresses: its socket, and the https one it probes.
	Voice         []string
	Vimeo, Twitch bool
}

// contentPolicy allows Clerk's script, sign-in calls and bot check only when
// sign-in is configured. Direct media needs https: because hls.js fetches its
// playlists and segments, from whatever host they are on, with fetch.
func contentPolicy(p policy) string {
	script, frame, images, connect := "", "", "", ""
	if p.Socket != "" {
		connect = " " + p.Socket
	}
	if p.DirectMedia {
		connect += " https:"
	}
	for _, origin := range p.Voice {
		connect += " " + origin
	}
	if p.Vimeo {
		frame += " https://player.vimeo.com"
		images += " https://i.vimeocdn.com"
	}
	if p.Twitch {
		script += " https://player.twitch.tv"
		frame += " https://player.twitch.tv"
	}
	if clerkHost := p.ClerkHost; clerkHost != "" {
		const challenge = " https://challenges.cloudflare.com"
		const protection = " https://*.protect.clerk.com"
		script += " https://" + clerkHost + challenge + protection
		frame += challenge
		images += " https://img.clerk.com"
		// Clerk's bot check probes several ports on this host.
		connect += " https://" + clerkHost + protection + ":*"
	}
	return "default-src 'self'; " +
		"script-src 'self' https://www.youtube.com https://s.ytimg.com" + script + "; " +
		"frame-src https://www.youtube.com https://www.youtube-nocookie.com" + frame + "; " +
		"img-src 'self' https://i.ytimg.com data:" + images + "; " +
		"media-src 'self' https: blob:; " +
		"style-src 'self' 'unsafe-inline'; " +
		"worker-src 'self' blob:; " +
		"connect-src 'self'" + connect + "; " +
		"object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
}

// withDeadline gives every request a deadline. A socket leaves it behind once it
// has upgraded, because Serve runs on a context without one.
func withDeadline(next http.Handler, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// namedHost sends a page opened at a loopback IP to the site's named address,
// because YouTube refuses many videos on a page whose address is an IP. Only
// browser navigation moves: scripts and health checks can use either address.
func namedHost(public string, next http.Handler) http.Handler {
	origin, err := url.Parse(public)
	if err != nil || net.ParseIP(origin.Hostname()) != nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if name, _, err := net.SplitHostPort(r.Host); err == nil {
			host = name
		}
		ip := net.ParseIP(strings.Trim(host, "[]"))
		if ip != nil && ip.IsLoopback() && r.Method == http.MethodGet && r.Header.Get("Sec-Fetch-Mode") == "navigate" {
			http.Redirect(w, r, public+r.URL.RequestURI(), http.StatusTemporaryRedirect)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler, policy string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("Content-Security-Policy", policy)
		header.Set("Permissions-Policy", "microphone=(self)")
		// YouTube's player needs the origin to identify the embedding site.
		header.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		header.Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

type problem struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeProblem(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, problem{Code: code, Message: message})
}

func (s *Server) internal(w http.ResponseWriter, err error) {
	s.Log.Error("request failed", "error", err)
	writeProblem(w, http.StatusInternalServerError, "unavailable", "Something went wrong. Try again.")
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	body := http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(body).Decode(into); err != nil && !errors.Is(err, io.EOF) {
		writeProblem(w, http.StatusBadRequest, "bad_request", "That request could not be read.")
		return false
	}
	return true
}

// clientIP returns the address limits are charged to. Behind a proxy that is the
// last X-Forwarded-For entry, the one the proxy added itself: anything before it
// came from the client and can say whatever the client likes.
func (s *Server) clientIP(r *http.Request) string {
	if s.TrustedProxy {
		forwarded := r.Header.Values("X-Forwarded-For")
		if len(forwarded) > 0 {
			hops := strings.Split(forwarded[len(forwarded)-1], ",")
			if last := strings.TrimSpace(hops[len(hops)-1]); last != "" {
				return last
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.Pool.Ping(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err := s.Redis.Ping(ctx).Err(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"sources":             s.Catalog.Names(),
		"clerkPublishableKey": s.ClerkPublishableKey,
		"voice":               s.Voice.Enabled(),
		"vapidPublicKey":      s.VAPIDPublicKey,
		"twitchParent":        s.TwitchParent,
	})
}

// session returns the caller's identity, if any. An error means a signed-in
// cookie could not be checked against sign-out. Nobody is trusted on it, and the
// caller must not treat it as no session either: starting a guest would replace
// the cookie of someone who is still signed in.
func (s *Server) session(r *http.Request) (auth.Claims, bool, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return auth.Claims{}, false, nil
	}
	claims, err := s.Issuer.Verify(cookie.Value)
	if err != nil {
		return auth.Claims{}, false, nil
	}
	if claims.Account {
		live, err := s.sessionLive(r.Context(), claims)
		if err != nil {
			return auth.Claims{}, false, err
		}
		if !live {
			return auth.Claims{}, false, nil
		}
	}
	// Cookies from before names were checked can hold what Postgres refuses.
	if name, ok := room.CleanName(claims.Name); ok {
		claims.Name = name
	} else {
		claims.Name = ids.GuestName()
	}
	return claims, true, nil
}

// sessionLive reports whether sign-out has left this signed-in cookie valid.
func (s *Server) sessionLive(ctx context.Context, claims auth.Claims) (bool, error) {
	version, err := s.versions.current(ctx, claims.Subject, s.DB.SessionVersion)
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("session check: %w", err)
	}
	return version == claims.Version, nil
}

func (s *Server) setSession(w http.ResponseWriter, claims auth.Claims) (auth.Claims, error) {
	token, err := s.Issuer.Issue(claims, sessionTTL)
	if err != nil {
		return auth.Claims{}, err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.Secure,
		SameSite: http.SameSiteLaxMode,
	})
	return claims, nil
}

// ensureSession signs a visitor in as a guest the first time they act, so no
// one has to create an account to watch.
func (s *Server) ensureSession(w http.ResponseWriter, r *http.Request) (auth.Claims, error) {
	claims, ok, err := s.session(r)
	if err != nil {
		return auth.Claims{}, err
	}
	if ok {
		return claims, s.DB.EnsureUser(r.Context(), claims.Subject, claims.Name)
	}
	allowed, err := s.Live.Limit(r.Context(), "guest:"+s.clientIP(r), guestsPerHour, time.Hour)
	if err != nil {
		return auth.Claims{}, err
	}
	if !allowed {
		return auth.Claims{}, errRateLimited
	}
	claims, err = s.setSession(w, auth.Claims{Subject: "g_" + ids.New(), Name: ids.GuestName()})
	if err != nil {
		return auth.Claims{}, err
	}
	return claims, s.DB.EnsureUser(r.Context(), claims.Subject, claims.Name)
}

var errRateLimited = errors.New("rate limited")

func (s *Server) sessionFailed(w http.ResponseWriter, err error) {
	if errors.Is(err, errRateLimited) {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many new sessions. Try again later.")
		return
	}
	s.internal(w, err)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	claims, ok, err := s.session(r)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": publicUser(claims)})
}

func publicUser(claims auth.Claims) map[string]any {
	return map[string]any{"id": claims.Subject, "name": claims.Name, "avatarUrl": claims.Avatar, "signedIn": claims.Account}
}

// clerkSession swaps a Clerk session token for this app's own cookie, so the
// rest of the app treats a signed-in person and a guest the same way.
func (s *Server) clerkSession(w http.ResponseWriter, r *http.Request) {
	if s.Clerk == nil {
		writeProblem(w, http.StatusNotFound, "not_found", "Sign-in is not available.")
		return
	}
	token, found := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !found {
		writeProblem(w, http.StatusUnauthorized, "unauthorized", "Sign in again.")
		return
	}
	allowed, err := s.Live.Limit(r.Context(), "clerk:"+s.clientIP(r), 300, time.Hour)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many sign-ins. Try again later.")
		return
	}
	identity, err := s.Clerk.Verify(r.Context(), token)
	if errors.Is(err, auth.ErrInvalidToken) {
		writeProblem(w, http.StatusUnauthorized, "unauthorized", "Sign in again.")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}

	// A guest is never in doubt, and an account hands over nothing.
	current, _, _ := s.session(r)
	if current.Account {
		current = auth.Claims{} // Only a guest hands anything over to an account.
	}
	name := identity.Name
	if name == "" {
		name = current.Name
	}
	if name == "" {
		name = ids.GuestName()
	}
	account, err := s.DB.LinkClerkUser(r.Context(), identity.ClerkID, current.Subject, "u_"+ids.New(), name, identity.AvatarURL)
	if err != nil {
		s.internal(w, err)
		return
	}
	claims, err := s.setSession(w, auth.Claims{
		Subject: account.ID, Name: account.Name, Avatar: identity.AvatarURL, Account: true, Version: account.SessionVersion,
	})
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": publicUser(claims)})
}

// endSession signs the browser out, and every other copy of an account's cookie
// with it. The next action starts a new guest.
func (s *Server) endSession(w http.ResponseWriter, r *http.Request) {
	claims, ok, err := s.session(r)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteLaxMode,
	})
	// This browser is out either way. Its other copies are not, and it should know.
	if err != nil {
		s.internal(w, err)
		return
	}
	if ok && claims.Account {
		if err := s.DB.BumpSessionVersion(r.Context(), claims.Subject); err != nil {
			s.internal(w, err)
			return
		}
		s.versions.forget(claims.Subject)
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": nil})
}

func (s *Server) rename(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &request) {
		return
	}
	name, ok := room.CleanName(request.Name)
	if !ok {
		writeProblem(w, http.StatusBadRequest, "invalid", "Names can be up to 32 characters, without control characters.")
		return
	}
	claims, err := s.ensureSession(w, r)
	if err != nil {
		s.sessionFailed(w, err)
		return
	}
	claims.Name = name
	// The database goes first: a cookie must never promise what it refused.
	if err := s.DB.EnsureUser(r.Context(), claims.Subject, name); err != nil {
		s.internal(w, err)
		return
	}
	if _, err := s.setSession(w, claims); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": publicUser(claims)})
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	var request struct {
		URL string `json:"url"`
	}
	if !decode(w, r, &request) {
		return
	}
	claims, err := s.ensureSession(w, r)
	if err != nil {
		s.sessionFailed(w, err)
		return
	}
	limit := "rooms:" + s.clientIP(r)
	allowed, err := s.Live.Limit(r.Context(), limit, roomsPerHour, time.Hour)
	if err != nil {
		s.internal(w, err)
		return
	}
	// Taken up front so parallel requests can't overrun the limit, and handed
	// back below by anything that doesn't end in a room.
	created := false
	defer func() {
		if created {
			return
		}
		if err := s.Live.Refund(context.WithoutCancel(r.Context()), limit); err != nil {
			s.Log.Warn("room limit refund failed", "error", err)
		}
	}()
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many new rooms. Try again later.")
		return
	}

	state := room.New()
	if request.URL != "" {
		media, err := s.Catalog.Resolve(r.Context(), request.URL, source.LookupCharge(s.Live.Limit, s.clientIP(r)))
		if err != nil {
			s.mediaFailed(w, err)
			return
		}
		state, _, err = room.Apply(state, room.Actor{ID: claims.Subject, Name: claims.Name, Role: room.RoleHost},
			room.Command{Type: room.CmdQueueAdd, Media: &media, NewItemID: ids.New()}, time.Now().UnixMilli())
		if err != nil {
			s.internal(w, err)
			return
		}
	}

	record := store.Room{ID: ids.New(), OwnerID: claims.Subject}
	record.Slug, err = claimSlug(ids.Slug, func(slug string) error {
		record.Slug, record.Name = slug, ids.RoomNameFor(slug)
		return s.DB.CreateRoom(r.Context(), record)
	})
	if err != nil {
		s.internal(w, err)
		return
	}
	// Nothing else saves a room that plays what it was made with, so without this
	// losing Redis would lose its video.
	if err := s.DB.SaveSnapshot(r.Context(), record.ID, state); err != nil {
		s.internal(w, err)
		return
	}
	if err := s.Live.Seed(r.Context(), record.ID, state); err != nil {
		s.internal(w, err)
		return
	}
	created = true
	writeJSON(w, http.StatusCreated, map[string]string{"slug": record.Slug, "name": record.Name})
}

// claimSlug retries on the rare address that is already in use.
func claimSlug(next func() string, create func(slug string) error) (string, error) {
	err := store.ErrSlugTaken
	for range slugAttempts {
		slug := next()
		if err = create(slug); !errors.Is(err, store.ErrSlugTaken) {
			return slug, err
		}
	}
	return "", err
}

func (s *Server) mediaFailed(w http.ResponseWriter, err error) {
	if errors.Is(err, source.ErrTooManyLinks) {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", err.Error())
		return
	}
	if source.IsUserError(err) {
		writeProblem(w, http.StatusUnprocessableEntity, "media", err.Error())
		return
	}
	s.internal(w, err)
}

func (s *Server) findRoom(w http.ResponseWriter, r *http.Request) (store.Room, bool) {
	record, err := s.DB.RoomBySlug(r.Context(), r.PathValue("slug"))
	if errors.Is(err, store.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "room_not_found", "This room does not exist.")
		return store.Room{}, false
	}
	if err != nil {
		s.internal(w, err)
		return store.Room{}, false
	}
	if record.ClosedAt != nil {
		writeProblem(w, http.StatusGone, "room_closed", "This room has closed.")
		return store.Room{}, false
	}
	return record, true
}

// preview is what someone sees before joining.
type preview struct {
	Slug       string         `json:"slug"`
	Name       string         `json:"name"`
	NowPlaying *room.Media    `json:"nowPlaying"`
	Playback   *playbackPeek  `json:"playback"`
	Members    []store.Person `json:"members"`
	MaxMembers int            `json:"maxMembers"`
	Crew       *crewSummary   `json:"crew,omitempty"`
}

// playbackPeek is where a room is, without the fields only the sync engine needs.
type playbackPeek struct {
	Status string  `json:"status"`
	Pos    float64 `json:"pos"`
}

func (s *Server) buildPreview(ctx context.Context, record store.Room) (preview, error) {
	out := preview{Slug: record.Slug, Name: record.Name, Members: []store.Person{}, MaxMembers: record.MaxMembers}
	now := time.Now().UnixMilli()
	state, found, err := s.Live.Load(ctx, record.ID)
	if err != nil {
		return out, err
	}
	if !found {
		var savedAt time.Time
		if state, savedAt, err = s.DB.LoadSnapshot(ctx, record.ID); err != nil {
			return out, err
		}
		state = state.Rested(savedAt.UnixMilli(), now)
	}
	if len(state.Queue) > 0 {
		out.NowPlaying = &state.Queue[0].Media
		out.Playback = &playbackPeek{Status: state.Playback.Status, Pos: state.PositionAt(now)}
	}
	if _, err := s.Live.Prune(ctx, record.ID); err != nil {
		return out, err
	}
	people, err := s.Live.People(ctx, record.ID)
	if err != nil {
		return out, err
	}
	out.Members = store.WithActingHost(people, state)
	return out, nil
}

func (s *Server) roomPreview(w http.ResponseWriter, r *http.Request) {
	record, ok := s.findRoom(w, r)
	if !ok {
		return
	}
	out, err := s.buildPreview(r.Context(), record)
	if err == nil {
		out.Crew, err = s.crewPreview(r, record)
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	// The door says whose room it is. What's inside is for the crew.
	if crew := out.Crew; crew != nil && !crew.IsMember && !crew.GuestAccess {
		out.NowPlaying, out.Playback, out.Members = nil, nil, []store.Person{}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) ticket(w http.ResponseWriter, r *http.Request) {
	allowed, wait, err := s.Live.LimitFor(r.Context(), "ticket:"+s.clientIP(r), ticketsPerMinute, time.Minute)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		// The client waits this out and tries again, so a party on one address
		// that hits the limit is delayed rather than turned away.
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many people are joining from here. Trying again.")
		return
	}
	record, ok := s.findRoom(w, r)
	if !ok {
		return
	}
	claims, err := s.ensureSession(w, r)
	if err != nil {
		s.sessionFailed(w, err)
		return
	}

	member, ok := s.crewEntry(w, r, record, claims)
	if !ok {
		return
	}
	// With nobody connected nothing else clears what a crashed server left, and
	// those ghosts would fill the room.
	if _, err := s.Live.Prune(r.Context(), record.ID); err != nil {
		s.internal(w, err)
		return
	}
	sockets, err := s.Live.Sockets(r.Context(), record.ID, claims.Subject)
	if err != nil {
		s.internal(w, err)
		return
	}
	if sockets >= hub.MaxSocketsPerUser {
		writeProblem(w, http.StatusConflict, "too_many_connections", "You have this room open in too many tabs.")
		return
	}
	people, err := s.Live.People(r.Context(), record.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	present := false
	for _, person := range people {
		present = present || person.UserID == claims.Subject
	}
	role := room.RoleMember
	if claims.Subject == record.OwnerID {
		role = room.RoleHost
	}
	// A crowd must never lock the owner out of their own room.
	if !present && role != room.RoleHost && len(people) >= record.MaxMembers {
		writeProblem(w, http.StatusConflict, "room_full", "This room is full.")
		return
	}
	id := ids.New()
	err = s.Live.PutTicket(r.Context(), id, store.Ticket{
		RoomID:         record.ID,
		RoomSlug:       record.Slug,
		RoomName:       record.Name,
		MaxMembers:     record.MaxMembers,
		Account:        claims.Account,
		SessionVersion: claims.Version,
		Address:        s.clientIP(r),
		Person:         store.Person{UserID: claims.Subject, Name: claims.Name, Role: role, AvatarURL: claims.Avatar, Member: member},
	})
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ticket": id})
}

func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	ticket, found, err := s.Live.TakeTicket(r.Context(), r.URL.Query().Get("ticket"))
	if err != nil {
		s.internal(w, err)
		return
	}
	if !found {
		writeProblem(w, http.StatusUnauthorized, "bad_ticket", "This connection has expired.")
		return
	}

	origin, err := url.Parse(s.PublicOrigin)
	if err != nil {
		s.internal(w, err)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{origin.Host}})
	if err != nil {
		return
	}
	defer ws.CloseNow()
	s.Hub.Serve(context.WithoutCancel(r.Context()), ws, ticket)
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	claims, ok, err := s.session(r)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "unauthorized", "Join the room to read its chat.")
		return
	}
	record, ok := s.findRoom(w, r)
	if !ok {
		return
	}
	if _, ok := s.crewEntry(w, r, record, claims); !ok {
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	items, err := s.roomMessages(r, record, before, 50)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	allowed, err := s.Live.Limit(r.Context(), "search:"+s.clientIP(r), searchesPerHour, time.Hour)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many searches. Try again later.")
		return
	}
	query := r.URL.Query().Get("q")
	if utf8.RuneCountInString(query) > searchMaxQuery {
		writeProblem(w, http.StatusBadRequest, "invalid", "That search is too long.")
		return
	}
	// No region from the client: each new value would miss the cache and spend
	// the day's search quota.
	items, err := s.Catalog.Search(r.Context(), "youtube", query, "")
	if err != nil {
		s.mediaFailed(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) trending(w http.ResponseWriter, r *http.Request) {
	items, err := s.Catalog.Trending(r.Context(), "youtube")
	if err != nil {
		s.mediaFailed(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) telemetry(w http.ResponseWriter, r *http.Request) {
	allowed, err := s.Live.Limit(r.Context(), "telemetry:"+s.clientIP(r), telemetryPerMinute, time.Minute)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !allowed {
		writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Slow down a little.")
		return
	}
	var request struct {
		Events []struct {
			Name   string  `json:"name"`
			Value  float64 `json:"value"`
			Room   string  `json:"room"`
			Source string  `json:"source"`
			Detail string  `json:"detail"`
		} `json:"events"`
	}
	if !decode(w, r, &request) {
		return
	}
	claims, _, _ := s.session(r) // Anonymous samples are still samples.
	at := time.Now().UTC().Format("2006-01-02 15:04:05.000")
	for i, event := range request.Events {
		if i >= 100 {
			break
		}
		s.Sink.Add(telemetry.Event{
			At: at, Name: event.Name, Value: event.Value, RoomID: event.Room,
			UserID: claims.Subject, Source: event.Source, Detail: event.Detail,
		})
	}
	w.WriteHeader(http.StatusAccepted)
}

// roomPage serves the app with link-preview tags for this room.
func (s *Server) roomPage(w http.ResponseWriter, r *http.Request) {
	card := siteCard
	if record, err := s.DB.RoomBySlug(r.Context(), r.PathValue("slug")); err == nil {
		var playing *room.Media
		// Cards go to whoever a link is pasted in front of, so they show what a stranger may see.
		access, err := s.DB.CrewAccessOf(r.Context(), record.ID, "")
		if err == nil && !crewPrivate(access) {
			if out, err := s.buildPreview(r.Context(), record); err == nil {
				playing = out.NowPlaying
			}
		}
		card = roomCard(record.Name, playing)
	}
	s.pageWithCard(w, r, card)
}
