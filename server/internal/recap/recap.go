// Package recap works out what a finished session amounted to. It reads nothing
// and writes nothing, and it never sees a title: see section 2 of the phase 2 plan.
package recap

import "slices"

const (
	// biggestWindowMs is how wide the biggest moment is.
	biggestWindowMs = 20_000
	biggestEvents   = 3
	biggestPeople   = 2

	KindReaction = "reaction"
	KindChat     = "chat"
)

// Person came to the session.
type Person struct {
	Name    string `json:"name"`
	IsGuest bool   `json:"isGuest"`
}

// Video is one thing the session watched.
type Video struct {
	Source   string
	SourceID string
}

// Moment is one reaction or chat line, without its text.
type Moment struct {
	Video
	PosMs  int64
	Kind   string
	UserID string
	Emoji  string
}

// Input is everything a recap is built from.
type Input struct {
	WallMs  int64
	People  []Person
	Videos  []Video
	Moments []Moment
}

// Item is one video's share of the session.
type Item struct {
	Source    string `json:"source"`
	SourceID  string `json:"sourceId"`
	Reactions int    `json:"reactions"`
	Messages  int    `json:"messages"`
}

// Biggest is the densest stretch of the session.
type Biggest struct {
	Source   string         `json:"source"`
	SourceID string         `json:"sourceId"`
	PosMs    int64          `json:"posMs"`
	Emojis   map[string]int `json:"emojis"`
	People   int            `json:"people"`
	// Events counts chat too, which has no emoji.
	Events int `json:"events"`
}

// Doc is the stored recap.
type Doc struct {
	WallMs    int64          `json:"wallMs"`
	People    []Person       `json:"people"`
	Items     []Item         `json:"items"`
	Reactions map[string]int `json:"reactions"`
	Biggest   *Biggest       `json:"biggest"`
}

// Build makes the recap. The same input always gives the same doc.
func Build(in Input) Doc {
	doc := Doc{WallMs: in.WallMs, People: in.People, Items: []Item{}, Reactions: map[string]int{}}
	if doc.People == nil {
		doc.People = []Person{}
	}
	positions := make(map[Video]int, len(in.Videos))
	for _, video := range in.Videos {
		// A video that has been purged has no id, and each one still gets a line.
		if _, seen := positions[video]; seen && video.SourceID != "" {
			continue
		}
		positions[video] = len(doc.Items)
		doc.Items = append(doc.Items, Item{Source: video.Source, SourceID: video.SourceID})
	}
	byVideo := make(map[Video][]Moment, len(positions))
	for _, m := range in.Moments {
		byVideo[m.Video] = append(byVideo[m.Video], m)
		at, known := positions[m.Video]
		switch {
		case m.Kind == KindReaction:
			doc.Reactions[m.Emoji]++
			if known {
				doc.Items[at].Reactions++
			}
		case known:
			doc.Items[at].Messages++
		}
	}
	for _, item := range doc.Items {
		video := Video{Source: item.Source, SourceID: item.SourceID}
		best := densest(video, byVideo[video])
		if best != nil && (doc.Biggest == nil || best.Events > doc.Biggest.Events) {
			doc.Biggest = best
		}
	}
	return doc
}

// densest slides a window along one video. A window only replaces a strictly
// bigger one, so a tie goes to the earliest.
func densest(video Video, moments []Moment) *Biggest {
	sorted := slices.Clone(moments)
	slices.SortStableFunc(sorted, func(a, b Moment) int { return int(a.PosMs - b.PosMs) })
	var best *Biggest
	bestSize, start := 0, 0
	for end := range sorted {
		for sorted[end].PosMs-sorted[start].PosMs >= biggestWindowMs {
			start++
		}
		size := end - start + 1
		if size <= bestSize || size < biggestEvents {
			continue
		}
		window := sorted[start : end+1]
		if people := distinctPeople(window); people >= biggestPeople {
			best, bestSize = describe(video, window, people), size
		}
	}
	return best
}

func distinctPeople(window []Moment) int {
	seen := make(map[string]struct{}, len(window))
	for _, m := range window {
		seen[m.UserID] = struct{}{}
	}
	return len(seen)
}

func describe(video Video, window []Moment, people int) *Biggest {
	emojis := make(map[string]int)
	for _, m := range window {
		if m.Kind == KindReaction {
			emojis[m.Emoji]++
		}
	}
	return &Biggest{
		Source: video.Source, SourceID: video.SourceID, PosMs: window[0].PosMs,
		Emojis: emojis, People: people, Events: len(window),
	}
}
