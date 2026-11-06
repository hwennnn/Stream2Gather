package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/room"
)

// ErrConflict means concurrent writers kept winning past the retry limit.
var ErrConflict = errors.New("room state conflict")

const (
	mutateAttempts = 60
	maxBackoff     = 20 * time.Millisecond
	liveTTL        = 7 * 24 * time.Hour
	ticketTTL      = 30 * time.Second
	presenceTTL    = 30 * time.Second
)

// casScript writes the state only if nobody else has since it was read, and
// publishes in the same step so subscribers see changes in version order.
var casScript = redis.NewScript(`
local current = tonumber(redis.call('HGET', KEYS[1], 'version') or '0')
if current ~= tonumber(ARGV[1]) then
  return 0
end
redis.call('HSET', KEYS[1], 'version', ARGV[2], 'doc', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('PUBLISH', KEYS[2], ARGV[5])
return 1
`)

// Live holds room state and presence in Redis.
type Live struct {
	rdb *redis.Client
}

// NewLive returns a live store.
func NewLive(rdb *redis.Client) *Live { return &Live{rdb: rdb} }

// Channel is the pub/sub channel for a room.
func Channel(roomID string) string { return "room:" + roomID + ":events" }

func stateKey(roomID string) string    { return "room:" + roomID + ":state" }
func presenceKey(roomID string) string { return "room:" + roomID + ":presence" }
func peopleKey(roomID string) string   { return "room:" + roomID + ":people" }

// Load returns the live state, or false if Redis has none.
func (l *Live) Load(ctx context.Context, roomID string) (room.State, bool, error) {
	doc, err := l.rdb.HGet(ctx, stateKey(roomID), "doc").Result()
	if errors.Is(err, redis.Nil) {
		return room.State{}, false, nil
	}
	if err != nil {
		return room.State{}, false, fmt.Errorf("load room: %w", err)
	}
	var state room.State
	if err := json.Unmarshal([]byte(doc), &state); err != nil {
		return room.State{}, false, fmt.Errorf("decode room: %w", err)
	}
	return state, true, nil
}

// Seed stores a state if Redis has none, for new rooms and rehydration.
func (l *Live) Seed(ctx context.Context, roomID string, state room.State) error {
	doc, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err := l.rdb.HSetNX(ctx, stateKey(roomID), "doc", doc).Err(); err != nil {
		return fmt.Errorf("seed room: %w", err)
	}
	if err := l.rdb.HSetNX(ctx, stateKey(roomID), "version", state.Version).Err(); err != nil {
		return fmt.Errorf("seed room: %w", err)
	}
	return l.rdb.Expire(ctx, stateKey(roomID), liveTTL).Err()
}

// Mutate applies a change with compare-and-set, retrying when another server
// won. change runs again on each retry, so it must be pure. message builds the
// event to publish from the state that was stored.
func (l *Live) Mutate(
	ctx context.Context,
	roomID string,
	change func(room.State) (room.State, error),
	message func(room.State) ([]byte, error),
) (room.State, error) {
	for attempt := range mutateAttempts {
		if attempt > 0 {
			// Jitter stops the same writers colliding again on the next try.
			wait := time.Duration(rand.Int64N(int64(min(time.Duration(attempt)*time.Millisecond, maxBackoff)) + 1))
			select {
			case <-ctx.Done():
				return room.State{}, ctx.Err()
			case <-time.After(wait):
			}
		}

		current, found, err := l.Load(ctx, roomID)
		if err != nil {
			return room.State{}, err
		}
		if !found {
			return room.State{}, fmt.Errorf("room %s has no live state", roomID)
		}

		next, err := change(current)
		if err != nil {
			return room.State{}, err
		}
		doc, err := json.Marshal(next)
		if err != nil {
			return room.State{}, err
		}
		event, err := message(next)
		if err != nil {
			return room.State{}, err
		}

		stored, err := casScript.Run(ctx, l.rdb,
			[]string{stateKey(roomID), Channel(roomID)},
			current.Version, next.Version, doc, int(liveTTL.Seconds()), event,
		).Int()
		if err != nil {
			return room.State{}, fmt.Errorf("store room: %w", err)
		}
		if stored == 1 {
			return next, nil
		}
	}
	return room.State{}, ErrConflict
}

// Publish sends an event that does not change room state, such as chat.
func (l *Live) Publish(ctx context.Context, roomID string, event []byte) error {
	return l.rdb.Publish(ctx, Channel(roomID), event).Err()
}

// Person is one connection's identity in a room.
type Person struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Role   string `json:"role"`
}

// Touch records that a connection is alive.
func (l *Live) Touch(ctx context.Context, roomID, connID string, person Person) error {
	doc, err := json.Marshal(person)
	if err != nil {
		return err
	}
	pipe := l.rdb.TxPipeline()
	pipe.ZAdd(ctx, presenceKey(roomID), redis.Z{Score: float64(time.Now().UnixMilli()), Member: connID})
	pipe.HSet(ctx, peopleKey(roomID), connID, doc)
	pipe.Expire(ctx, presenceKey(roomID), liveTTL)
	pipe.Expire(ctx, peopleKey(roomID), liveTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// Leave removes a connection.
func (l *Live) Leave(ctx context.Context, roomID, connID string) error {
	pipe := l.rdb.TxPipeline()
	pipe.ZRem(ctx, presenceKey(roomID), connID)
	pipe.HDel(ctx, peopleKey(roomID), connID)
	_, err := pipe.Exec(ctx)
	return err
}

// Prune drops connections that stopped refreshing, such as those of a crashed
// server, and reports how many went.
func (l *Live) Prune(ctx context.Context, roomID string) (int, error) {
	cutoff := fmt.Sprint(time.Now().Add(-presenceTTL).UnixMilli())
	stale, err := l.rdb.ZRangeByScore(ctx, presenceKey(roomID), &redis.ZRangeBy{Min: "-inf", Max: cutoff}).Result()
	if err != nil || len(stale) == 0 {
		return 0, err
	}
	pipe := l.rdb.TxPipeline()
	pipe.ZRem(ctx, presenceKey(roomID), toAny(stale)...)
	pipe.HDel(ctx, peopleKey(roomID), stale...)
	_, err = pipe.Exec(ctx)
	return len(stale), err
}

func toAny(values []string) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

// People returns everyone present, once each however many tabs they have open.
func (l *Live) People(ctx context.Context, roomID string) ([]Person, error) {
	docs, err := l.rdb.HVals(ctx, peopleKey(roomID)).Result()
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(docs))
	people := make([]Person, 0, len(docs))
	for _, doc := range docs {
		var person Person
		if err := json.Unmarshal([]byte(doc), &person); err != nil {
			return nil, err
		}
		if !seen[person.UserID] {
			seen[person.UserID] = true
			people = append(people, person)
		}
	}
	return people, nil
}

// Ticket is what a WebSocket upgrade exchanges for an identity.
type Ticket struct {
	RoomID   string `json:"roomId"`
	RoomSlug string `json:"roomSlug"`
	RoomName string `json:"roomName"`
	Person   Person `json:"person"`
}

// PutTicket stores a single-use ticket.
func (l *Live) PutTicket(ctx context.Context, id string, ticket Ticket) error {
	doc, err := json.Marshal(ticket)
	if err != nil {
		return err
	}
	return l.rdb.Set(ctx, "ticket:"+id, doc, ticketTTL).Err()
}

// TakeTicket consumes a ticket, so it cannot be used twice.
func (l *Live) TakeTicket(ctx context.Context, id string) (Ticket, bool, error) {
	doc, err := l.rdb.GetDel(ctx, "ticket:"+id).Result()
	if errors.Is(err, redis.Nil) {
		return Ticket{}, false, nil
	}
	if err != nil {
		return Ticket{}, false, err
	}
	var ticket Ticket
	return ticket, true, json.Unmarshal([]byte(doc), &ticket)
}

// CountFailure records that a viewer could not play an item, and returns how
// many distinct viewers have failed on it recently.
func (l *Live) CountFailure(ctx context.Context, roomID, itemID, userID string) (int64, error) {
	key := "room:" + roomID + ":failed:" + itemID
	pipe := l.rdb.TxPipeline()
	pipe.SAdd(ctx, key, userID)
	count := pipe.SCard(ctx, key)
	pipe.Expire(ctx, key, time.Minute)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return count.Val(), nil
}

// Limit reports whether a fixed-window limit still has room.
func (l *Live) Limit(ctx context.Context, key string, limit int64, window time.Duration) (bool, error) {
	pipe := l.rdb.TxPipeline()
	count := pipe.Incr(ctx, "limit:"+key)
	pipe.ExpireNX(ctx, "limit:"+key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, err
	}
	return count.Val() <= limit, nil
}

// MarkEmpty records when the last viewer left.
func (l *Live) MarkEmpty(ctx context.Context, roomID string, at int64) error {
	return l.rdb.Set(ctx, "room:"+roomID+":empty", at, liveTTL).Err()
}

// TakeEmpty returns and clears when the room emptied, or zero.
func (l *Live) TakeEmpty(ctx context.Context, roomID string) (int64, error) {
	at, err := l.rdb.GetDel(ctx, "room:"+roomID+":empty").Int64()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	return at, err
}
