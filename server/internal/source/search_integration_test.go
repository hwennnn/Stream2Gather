package source

import (
	"context"
	"sync/atomic"
	"testing"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
)

type countingSearch struct {
	fakeSource
	calls atomic.Int32
}

func (c *countingSearch) Search(context.Context, string, string) ([]room.Media, error) {
	c.calls.Add(1)
	return nil, nil
}

func TestASearchThatFindsNothingIsNotPaidForTwice(t *testing.T) {
	search := &countingSearch{}
	catalog := NewCatalog(catalogDB(t), 1_000_000, quiet(), search)
	query := "nothing-" + ids.New()

	for range 3 {
		items, err := catalog.Search(context.Background(), "fake", query, "")
		if err != nil {
			t.Fatal(err)
		}
		if items == nil || len(items) != 0 {
			t.Fatalf("items = %#v", items)
		}
	}
	if got := search.calls.Load(); got != 1 {
		t.Fatalf("%d calls to the source for one query", got)
	}
}
