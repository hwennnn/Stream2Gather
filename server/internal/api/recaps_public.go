package api

import (
	"context"
	"errors"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"stream2gather/internal/ids"
	"stream2gather/internal/store"
)

func (s *Server) recapURL(token string) string {
	return strings.TrimRight(s.PublicOrigin, "/") + "/s/" + token
}

func (s *Server) shareRecap(w http.ResponseWriter, r *http.Request) {
	claims, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	var request struct {
		Public bool `json:"public"`
	}
	if !decode(w, r, &request) {
		return
	}
	stored, err := s.DB.RecapOf(r.Context(), crew.ID, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && stored.Doc == nil) {
		writeProblem(w, http.StatusNotFound, "not_found", "That recap isn't ready.")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	attended, err := s.DB.Attended(r.Context(), stored.SessionID, claims.Subject)
	if err != nil {
		s.internal(w, err)
		return
	}
	if !attended {
		writeProblem(w, http.StatusForbidden, "not_attended", "Only people who were there can share this.")
		return
	}
	token := ""
	if request.Public {
		token = stored.ShareToken
		if token == "" {
			token = ids.New() + ids.New()
		}
	}
	if err := s.DB.ShareRecap(r.Context(), stored.SessionID, token); err != nil {
		s.internal(w, err)
		return
	}
	reply := map[string]string{}
	if token != "" {
		reply["url"] = s.recapURL(token)
	}
	writeJSON(w, http.StatusOK, reply)
}

// publicVideo is all a stranger with the link learns about a video. Chat isn't in here.
type publicVideo struct {
	Title        string `json:"title"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	Reactions    int    `json:"reactions"`
}

type publicMoment struct {
	Title  string         `json:"title"`
	PosMs  int64          `json:"posMs"`
	Emojis map[string]int `json:"emojis"`
	People int            `json:"people"`
}

type publicRecap struct {
	CrewName  string         `json:"crewName"`
	StartedAt time.Time      `json:"startedAt"`
	WallMs    int64          `json:"wallMs"`
	People    []string       `json:"people"`
	Videos    []publicVideo  `json:"videos"`
	Reactions map[string]int `json:"reactions"`
	Biggest   *publicMoment  `json:"biggest"`
}

func (s *Server) publicRecap(ctx context.Context, stored store.SessionRecap) (publicRecap, error) {
	doc := stored.Doc
	out := publicRecap{
		CrewName: stored.CrewName, StartedAt: stored.StartedAt, WallMs: doc.WallMs,
		People: make([]string, len(doc.People)), Videos: make([]publicVideo, len(doc.Items)), Reactions: doc.Reactions,
	}
	videos, err := s.freshVideos(ctx, doc)
	if err != nil {
		return out, err
	}
	for i, person := range doc.People {
		out.People[i] = person.Name
	}
	for i, item := range doc.Items {
		out.Videos[i] = publicVideo{Reactions: item.Reactions}
		if media := lookup(videos, item.Source, item.SourceID); media != nil {
			out.Videos[i].Title, out.Videos[i].URL, out.Videos[i].ThumbnailURL = media.Title, media.URL, media.ThumbnailURL
		}
	}
	if doc.Biggest != nil {
		out.Biggest = &publicMoment{PosMs: doc.Biggest.PosMs, Emojis: doc.Biggest.Emojis, People: doc.Biggest.People}
		if media := lookup(videos, doc.Biggest.Source, doc.Biggest.SourceID); media != nil {
			out.Biggest.Title = media.Title
		}
	}
	return out, nil
}

func (s *Server) sharedRecap(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store") // Revoking has to work on the next request.
	stored, err := s.DB.RecapByToken(r.Context(), r.PathValue("token"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && stored.Doc == nil) {
		writeProblem(w, http.StatusNotFound, "not_found", "This recap isn't shared.")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	out, err := s.publicRecap(r.Context(), stored)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// recapPage serves the app with link-preview tags, in the style of roomPage. The
// image is the video's live thumbnail, because we never draw one into our own.
func (s *Server) recapPage(w http.ResponseWriter, r *http.Request) {
	page, err := os.ReadFile(filepath.Join(s.WebDir, "index.html"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Robots-Tag", "noindex")

	stored, err := s.DB.RecapByToken(r.Context(), r.PathValue("token"))
	if err != nil || stored.Doc == nil {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write(page)
		return
	}
	title := stored.CrewName + "’s watch party"
	description := strconv.Itoa(len(stored.Doc.People)) + " people, " + strconv.Itoa(len(stored.Doc.Items)) + " videos"
	tags := `<meta property="og:title" content="` + html.EscapeString(title) + `">` +
		`<meta property="og:description" content="` + html.EscapeString(description) + `">`
	if out, err := s.publicRecap(r.Context(), stored); err == nil {
		for _, video := range out.Videos {
			if video.ThumbnailURL != "" {
				tags += `<meta property="og:image" content="` + html.EscapeString(video.ThumbnailURL) + `">`
				break
			}
		}
	}
	_, _ = w.Write([]byte(strings.Replace(string(page), "</head>", tags+"</head>", 1)))
}
