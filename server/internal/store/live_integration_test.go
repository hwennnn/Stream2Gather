package store

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/testenv"
)

// These tests need the Redis from deploy/compose.yaml and skip without it.
func liveStore(t *testing.T) *redis.Client {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: testenv.RedisAddr()})
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
	servers := []*Live{NewLive(rdb), NewLive(redis.NewClient(&redis.Options{Addr: testenv.RedisAddr()}))}

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

func TestSeedNeverOverwrites(t *testing.T) {
	live := NewLive(liveStore(t))
	ctx := context.Background()
	roomID := ids.New()
	first, second := room.New(), room.New()
	first.Version, second.Version = 5, 9
	for _, state := range []room.State{first, second} {
		if err := live.Seed(ctx, roomID, state); err != nil {
			t.Fatal(err)
		}
	}
	state, found, err := live.Load(ctx, roomID)
	if err != nil || !found || state.Version != 5 {
		t.Fatalf("state %+v, found %v, err %v", state, found, err)
	}
	if version, found, err := live.Version(ctx, roomID); err != nil || !found || version != 5 {
		t.Fatalf("version %d, found %v, err %v", version, found, err)
	}
}

func TestMutateNamesAMissingRoom(t *testing.T) {
	live := NewLive(liveStore(t))
	_, err := live.Mutate(context.Background(), ids.New(), apply(room.Actor{}, room.Command{}), noEvent)
	if !errors.Is(err, ErrNoState) {
		t.Fatalf("err = %v", err)
	}
}

func TestSocketsCountsEveryTab(t *testing.T) {
	live := NewLive(liveStore(t))
	ctx := context.Background()
	roomID := ids.New()
	for connID, userID := range map[string]string{"a": "u", "b": "u", "c": "v"} {
		if err := live.Touch(ctx, roomID, connID, Person{UserID: userID}); err != nil {
			t.Fatal(err)
		}
	}
	if count, err := live.Sockets(ctx, roomID, "u"); err != nil || count != 2 {
		t.Fatalf("count %d, err %v", count, err)
	}
}

func TestPruneMarksARoomEmptyWhenOnlyGhostsWereLeft(t *testing.T) {
	rdb := liveStore(t)
	live := NewLive(rdb)
	ctx := context.Background()
	roomID := ids.New()
	lastSeen := time.Now().Add(-2 * time.Minute).UnixMilli()
	ghost(t, rdb, roomID, "conn", lastSeen)

	pruned, err := live.Prune(ctx, roomID)
	if err != nil || pruned != 1 {
		t.Fatalf("pruned %d: %v", pruned, err)
	}
	if at, err := live.TakeEmpty(ctx, roomID); err != nil || at != lastSeen {
		t.Fatalf("emptied at %d, want %d: %v", at, lastSeen, err)
	}
}

func TestPruneLeavesARoomWithSomeoneInItAlone(t *testing.T) {
	rdb := liveStore(t)
	live := NewLive(rdb)
	ctx := context.Background()
	roomID := ids.New()
	ghost(t, rdb, roomID, "conn", time.Now().Add(-2*time.Minute).UnixMilli())
	if err := live.Touch(ctx, roomID, "alive", Person{UserID: "u"}); err != nil {
		t.Fatal(err)
	}

	if pruned, err := live.Prune(ctx, roomID); err != nil || pruned != 1 {
		t.Fatalf("pruned %d: %v", pruned, err)
	}
	if at, err := live.TakeEmpty(ctx, roomID); err != nil || at != 0 {
		t.Fatalf("emptied at %d with a viewer present: %v", at, err)
	}
}

// ghost leaves a connection behind the way a crash does.
func ghost(t *testing.T, rdb *redis.Client, roomID, connID string, lastSeen int64) {
	t.Helper()
	ctx := context.Background()
	if err := rdb.ZAdd(ctx, presenceKey(roomID), redis.Z{Score: float64(lastSeen), Member: connID}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.HSet(ctx, peopleKey(roomID), connID, `{"userId":"gone"}`).Err(); err != nil {
		t.Fatal(err)
	}
}
