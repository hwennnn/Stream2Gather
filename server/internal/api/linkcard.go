package api

import (
	"html"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"stream2gather/internal/room"
)

// linkCard is what a pasted link unfurls to. An empty Image means the default card.
type linkCard struct {
	Title, Description, Image string
}

var siteCard = linkCard{Title: "Stream2Gather", Description: "A room for watching YouTube with friends."}

func roomCard(name string, playing *room.Media) linkCard {
	card := linkCard{Title: name, Description: "Saved you a seat."}
	if playing != nil {
		card.Description = "Watching " + playing.Title + ". Saved you a seat."
		card.Image = playing.ThumbnailURL
	}
	return card
}

// tags are absolute because link scrapers do not resolve an image against the page.
func (c linkCard) tags(origin string) string {
	image := c.Image
	if image == "" {
		image = strings.TrimRight(origin, "/") + "/og.png"
	}
	meta := func(key, value string) string {
		return `<meta property="` + key + `" content="` + html.EscapeString(value) + `">`
	}
	return meta("og:site_name", "Stream2Gather") + meta("og:title", c.Title) +
		meta("og:description", c.Description) + meta("og:image", image) +
		`<meta name="twitter:card" content="summary_large_image">`
}

func (s *Server) pageWithCard(w http.ResponseWriter, r *http.Request, card linkCard) {
	page, err := os.ReadFile(filepath.Join(s.WebDir, "index.html"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write([]byte(strings.Replace(string(page), "</head>", card.tags(s.PublicOrigin)+"</head>", 1)))
}
