package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"stream2gather/internal/recap"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// recapVideo is a video in a recap, with what the source says about it today.
type recapVideo struct {
	recap.Item
	Media *room.Media `json:"media"`
}

type recapMoment struct {
	recap.Biggest
	Media *room.Media `json:"media"`
	// ItemID links to catch-up. It's zero when the video can't be played.
	ItemID int64 `json:"itemId,omitempty"`
}

// recapView is the recap as a member reads it. Building says it isn't ready.
type recapView struct {
	SessionID string         `json:"sessionId"`
	StartedAt time.Time      `json:"startedAt"`
	Building  bool           `json:"building,omitempty"`
	WallMs    int64          `json:"wallMs"`
	People    []recap.Person `json:"people"`
	Items     []recapVideo   `json:"items"`
	Reactions map[string]int `json:"reactions"`
	Biggest   *recapMoment   `json:"biggest"`
	Attended  bool           `json:"attended"`
	ShareURL  string         `json:"shareUrl,omitempty"`
}

// freshVideos joins today's metadata onto ids, so the stored doc never holds any.
func (s *Server) freshVideos(ctx context.Context, doc *recap.Doc) (map[string]room.Media, error) {
	queue := make([]room.Item, 0, len(doc.Items))
	for _, item := range doc.Items {
		queue = append(queue, room.Item{Media: room.Media{Source: item.Source, SourceID: item.SourceID}})
	}
	fresh, err := s.DB.FreshMedia(ctx, queue)
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]room.Media, len(fresh))
	for _, media := range fresh {
		byKey[media.Source+"\x00"+media.SourceID] = media
	}
	return byKey, nil
}

func lookup(videos map[string]room.Media, source, sourceID string) *room.Media {
	if media, ok := videos[source+"\x00"+sourceID]; ok {
		return &media
	}
	return nil
}

func (s *Server) viewRecap(ctx context.Context, stored store.SessionRecap) (recapView, error) {
	view := recapView{SessionID: stored.SessionID, StartedAt: stored.StartedAt, Building: stored.Doc == nil}
	if stored.Doc == nil {
		return view, nil
	}
	videos, err := s.freshVideos(ctx, stored.Doc)
	if err != nil {
		return view, err
	}
	doc := stored.Doc
	view.WallMs, view.People, view.Reactions = doc.WallMs, doc.People, doc.Reactions
	view.Items = make([]recapVideo, len(doc.Items))
	for i, item := range doc.Items {
		view.Items[i] = recapVideo{Item: item, Media: lookup(videos, item.Source, item.SourceID)}
	}
	if doc.Biggest != nil {
		view.Biggest = &recapMoment{Biggest: *doc.Biggest, Media: lookup(videos, doc.Biggest.Source, doc.Biggest.SourceID)}
		if view.Biggest.Media != nil {
			view.Biggest.ItemID, err = s.DB.SessionItemOf(ctx, stored.SessionID, doc.Biggest.Source, doc.Biggest.SourceID)
		}
	}
	return view, err
}

func (s *Server) sessionRecap(w http.ResponseWriter, r *http.Request) {
	claims, crew, ok := s.memberCrew(w, r)
	if !ok {
		return
	}
	stored, err := s.DB.RecapOf(r.Context(), crew.ID, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "not_found", "That session isn't here.")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	view, err := s.viewRecap(r.Context(), stored)
	if err != nil {
		s.internal(w, err)
		return
	}
	if view.Attended, err = s.DB.Attended(r.Context(), stored.SessionID, claims.Subject); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}
