package store

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
)

// These tests need the Redis from deploy/compose.yaml and skip without it.
func liveStore(t *testing.T) *redis.Client {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:63809"})
	t.Cleanup(func() { _ = rdb.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skip("redis not running:", err)
	}
	return rdb
}

func apply(actor room.Actor, cmd room.Command) func(room.State) (room.State, error) {
	return func(state room.State) (room.State, error) {
		next, _, err := room.Apply(state, actor, cmd, time.Now().UnixMilli())
		return next, err
	}
}

func noEvent(room.State) ([]byte, error) { return []byte("{}"), nil }

// The legacy server kept 2 of 100 concurrent queue adds.
func TestConcurrentQueueAddsAllSurviveAcrossServers(t *testing.T) {
	rdb := liveStore(t)
	servers := []*Live{NewLive(rdb), NewLive(redis.NewClient(&redis.Options{Addr: "127.0.0.1:63809"}))}

	ctx := context.Background()
	roomID := ids.New()
	if err := servers[0].Seed(ctx, roomID, room.New()); err != nil {
		t.Fatal(err)
	}

	const adds = 150
	var wg sync.WaitGroup
	var failed atomic.Int64
	for i := range adds {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := room.Command{Type: room.CmdQueueAdd, NewItemID: fmt.Sprint(i), Media: &room.Media{Source: "x"}}
			if _, err := servers[i%2].Mutate(ctx, roomID, apply(room.Actor{ID: "u"}, cmd), noEvent); err != nil {
				failed.Add(1)
			}
		}()
	}
	wg.Wait()

	state, _, err := servers[0].Load(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	if failed.Load() != 0 || len(state.Queue) != adds || state.Version != adds {
		t.Fatalf("failed %d, queue %d, version %d, want %d adds", failed.Load(), len(state.Queue), state.Version, adds)
	}
}

func TestTicketIsSingleUse(t *testing.T) {
	live := NewLive(liveStore(t))
	ctx := context.Background()
	id := ids.New()
	if err := live.PutTicket(ctx, id, Ticket{RoomID: "r"}); err != nil {
		t.Fatal(err)
	}
	if _, found, err := live.TakeTicket(ctx, id); err != nil || !found {
		t.Fatalf("first use: found %v, err %v", found, err)
	}
	if _, found, _ := live.TakeTicket(ctx, id); found {
		t.Fatal("ticket worked twice")
	}
}

func TestPeopleAreDedupedAcrossTabs(t *testing.T) {
	live := NewLive(liveStore(t))
	ctx := context.Background()
	roomID := ids.New()
	person := Person{UserID: "u", Name: "Sam"}
	for _, conn := range []string{"tab1", "tab2"} {
		if err := live.Touch(ctx, roomID, conn, person); err != nil {
			t.Fatal(err)
		}
	}
	people, err := live.People(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	if len(people) != 1 {
		t.Fatalf("people = %+v", people)
	}
}
