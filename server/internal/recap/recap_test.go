package recap

import (
	"reflect"
	"testing"
)

var film = Video{Source: "youtube", SourceID: "film"}
var short = Video{Source: "youtube", SourceID: "short"}

func react(video Video, posMs int64, user string) Moment {
	return Moment{Video: video, PosMs: posMs, Kind: KindReaction, UserID: user, Emoji: "🔥"}
}

func TestBiggestMoment(t *testing.T) {
	cases := []struct {
		name    string
		moments []Moment
		want    int64 // -1 for none
	}{
		{"nothing happened", nil, -1},
		{"two events are too few", []Moment{react(film, 0, "a"), react(film, 1000, "b")}, -1},
		{"one person alone never counts", []Moment{react(film, 0, "a"), react(film, 1, "a"), react(film, 2, "a"), react(film, 3, "a")}, -1},
		{"three from two people qualify", []Moment{react(film, 5000, "a"), react(film, 6000, "a"), react(film, 7000, "b")}, 5000},
		{"19.999 seconds is inside the window", []Moment{react(film, 0, "a"), react(film, 10_000, "b"), react(film, 19_999, "a")}, 0},
		{"20 seconds is outside it", []Moment{react(film, 0, "a"), react(film, 10_000, "b"), react(film, 20_000, "a")}, -1},
		{"the denser window wins", []Moment{
			react(film, 0, "a"), react(film, 1000, "b"), react(film, 2000, "a"),
			react(film, 60_000, "a"), react(film, 61_000, "b"), react(film, 62_000, "a"), react(film, 63_000, "b"),
		}, 60_000},
		{"a tie goes to the earliest", []Moment{
			react(film, 60_000, "a"), react(film, 61_000, "b"), react(film, 62_000, "a"),
			react(film, 0, "a"), react(film, 1000, "b"), react(film, 2000, "a"),
		}, 0},
		{"chat counts as an event", []Moment{
			react(film, 0, "a"), {Video: film, PosMs: 100, Kind: KindChat, UserID: "b"}, {Video: film, PosMs: 200, Kind: KindChat, UserID: "b"},
		}, 0},
		{"windows don't span videos", []Moment{react(film, 0, "a"), react(short, 1, "b"), react(short, 2, "a")}, -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			doc := Build(Input{Videos: []Video{film, short}, Moments: c.moments})
			switch {
			case c.want < 0 && doc.Biggest != nil:
				t.Fatalf("got %+v", doc.Biggest)
			case c.want >= 0 && doc.Biggest == nil:
				t.Fatal("no biggest moment")
			case c.want >= 0 && doc.Biggest.PosMs != c.want:
				t.Fatalf("at %d", doc.Biggest.PosMs)
			}
		})
	}
}

func TestATieBetweenVideosGoesToTheOneWatchedFirst(t *testing.T) {
	doc := Build(Input{Videos: []Video{short, film}, Moments: []Moment{
		react(film, 0, "a"), react(film, 1, "b"), react(film, 2, "a"),
		react(short, 500, "a"), react(short, 501, "b"), react(short, 502, "a"),
	}})
	if doc.Biggest == nil || doc.Biggest.SourceID != "short" {
		t.Fatalf("%+v", doc.Biggest)
	}
}

func TestCountsAreByVideoAndAVideoWatchedTwiceIsOneRow(t *testing.T) {
	doc := Build(Input{
		WallMs: 60_000,
		People: []Person{{Name: "Hana"}},
		Videos: []Video{film, short, film},
		Moments: []Moment{
			react(film, 0, "a"),
			{Video: short, Kind: KindReaction, Emoji: "😂", UserID: "a"},
			{Video: short, Kind: KindChat, UserID: "a"},
		},
	})
	want := []Item{{Source: "youtube", SourceID: "film", Reactions: 1}, {Source: "youtube", SourceID: "short", Reactions: 1, Messages: 1}}
	if !reflect.DeepEqual(doc.Items, want) {
		t.Fatalf("%+v", doc.Items)
	}
	if !reflect.DeepEqual(doc.Reactions, map[string]int{"🔥": 1, "😂": 1}) {
		t.Fatalf("%+v", doc.Reactions)
	}
}

func TestAQuietSessionWithNoVideosStillBuilds(t *testing.T) {
	doc := Build(Input{WallMs: 1000})
	if doc.Items == nil || doc.People == nil || doc.Reactions == nil || doc.Biggest != nil {
		t.Fatalf("%+v", doc)
	}
}

func TestBuildingTwiceGivesTheSameDoc(t *testing.T) {
	in := Input{Videos: []Video{film}, Moments: []Moment{react(film, 0, "a"), react(film, 1, "b"), react(film, 2, "a")}}
	if !reflect.DeepEqual(Build(in), Build(in)) {
		t.Fatal("not stable")
	}
}

func TestEveryPurgedVideoKeepsItsLine(t *testing.T) {
	doc := Build(Input{Videos: []Video{{Source: "youtube"}, {Source: "youtube", SourceID: "a"}, {Source: "youtube"}}})
	if len(doc.Items) != 3 {
		t.Fatalf("%d items", len(doc.Items))
	}
}
