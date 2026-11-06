package store

import (
	"reflect"
	"testing"
)

func TestMergeTabs(t *testing.T) {
	cases := []struct {
		name string
		tabs []Person
		want []Person
	}{
		{"voice in the first tab", []Person{{UserID: "a", Voice: "live"}, {UserID: "a"}}, []Person{{UserID: "a", Voice: "live"}}},
		{"voice in a later tab", []Person{{UserID: "a"}, {UserID: "a", Voice: "muted"}}, []Person{{UserID: "a", Voice: "muted"}}},
		{"member in a later tab", []Person{{UserID: "a"}, {UserID: "a", Member: true}}, []Person{{UserID: "a", Member: true}}},
		{"people stay apart", []Person{{UserID: "a", Voice: "live"}, {UserID: "b"}}, []Person{{UserID: "a", Voice: "live"}, {UserID: "b"}}},
	}
	for _, c := range cases {
		if got := mergeTabs(c.tabs); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}
}
