package api

import (
	"context"
	"crypto/sha256"
	"errors"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"stream2gather/internal/ids"
	"stream2gather/internal/recap"
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
	// Dots is empty for a video of unknown length, because there's no line to put them on.
	Dots []publicDot `json:"dots"`
}

// publicDot is someone reacting: how far through the video, and a seat that isn't a person.
type publicDot struct {
	At   int `json:"at"`
	Seat int `json:"seat"`
}

type publicMoment struct {
	Title  string         `json:"title"`
	PosMs  int64          `json:"posMs"`
	Emojis map[string]int `json:"emojis"`
	People int            `json:"people"`
	// Video and At place it on the night's picture. Video is -1 when it isn't one of the videos.
	Video int `json:"video"`
	At    int `json:"at"`
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

// seatsOf numbers whoever reacted in an order the token decides. People are listed by name
// on the page, so a seat must not line up with that list or with anyone's usual colour:
// the dots show the night's shape, and a stranger can't read who reacted when.
func seatsOf(token string, reactions []recap.Moment) map[string]int {
	var people []string
	seen := map[string]bool{}
	for _, reaction := range reactions {
		if reaction.UserID != "" && !seen[reaction.UserID] {
			seen[reaction.UserID] = true
			people = append(people, reaction.UserID)
		}
	}
	key := func(userID string) [sha256.Size]byte { return sha256.Sum256([]byte(token + "\x00" + userID)) }
	slices.SortFunc(people, func(a, b string) int {
		left, right := key(a), key(b)
		return slices.Compare(left[:], right[:])
	})
	seats := make(map[string]int, len(people))
	for seat, userID := range people {
		seats[userID] = seat
	}
	return seats
}

// through says how far into a video a position is, in whole percent.
func through(posMs, lengthMs int64) int {
	return int(min(posMs*100/lengthMs, 100))
}

// dotsOf draws one dot per seat at each place, so a burst doesn't send a hundred.
func dotsOf(item recap.Item, lengthMs int64, reactions []recap.Moment, seats map[string]int) []publicDot {
	dots := []publicDot{}
	if lengthMs <= 0 {
		return dots
	}
	drawn := map[publicDot]bool{}
	for _, reaction := range reactions {
		if reaction.Source != item.Source || reaction.SourceID != item.SourceID {
			continue
		}
		seat, known := seats[reaction.UserID]
		if !known {
			seat = -1
		}
		dot := publicDot{At: through(reaction.PosMs, lengthMs), Seat: seat}
		if !drawn[dot] {
			drawn[dot] = true
			dots = append(dots, dot)
		}
	}
	return dots
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
	reactions, err := s.DB.SessionReactions(ctx, stored.SessionID)
	if err != nil {
		return out, err
	}
	seats := seatsOf(stored.ShareToken, reactions)
	for i, item := range doc.Items {
		out.Videos[i] = publicVideo{Reactions: item.Reactions, Dots: []publicDot{}}
		if media := lookup(videos, item.Source, item.SourceID); media != nil {
			out.Videos[i].Title, out.Videos[i].URL, out.Videos[i].ThumbnailURL = media.Title, media.URL, media.ThumbnailURL
			out.Videos[i].Dots = dotsOf(item, media.DurationMS, reactions, seats)
		}
	}
	if doc.Biggest != nil {
		out.Biggest = &publicMoment{PosMs: doc.Biggest.PosMs, Emojis: doc.Biggest.Emojis, People: doc.Biggest.People}
		out.Biggest.Video = slices.IndexFunc(doc.Items, func(item recap.Item) bool {
			return item.Source == doc.Biggest.Source && item.SourceID == doc.Biggest.SourceID
		})
		if media := lookup(videos, doc.Biggest.Source, doc.Biggest.SourceID); media != nil {
			out.Biggest.Title = media.Title
			if media.DurationMS > 0 {
				out.Biggest.At = through(doc.Biggest.PosMs, media.DurationMS)
			}
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
