package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/room"
)

var (
	// ErrConflict means concurrent writers kept winning past the retry limit.
	ErrConflict = errors.New("room state conflict")
	// ErrNoState means Redis has forgotten the room.
	ErrNoState = errors.New("room has no live state")
)

const (
	mutateAttempts = 60
	maxBackoff     = 20 * time.Millisecond
	liveTTL        = 7 * 24 * time.Hour
	ticketTTL      = 30 * time.Second
	presenceTTL    = 30 * time.Second
	// A video's embed reports must agree within this long.
	embedReportTTL = 7 * 24 * time.Hour
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

// seedScript writes both fields or neither, so two servers rehydrating the same
// room cannot leave one's version beside the other's document.
var seedScript = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('HSET', KEYS[1], 'version', ARGV[1], 'doc', ARGV[2])
end
redis.call('EXPIRE', KEYS[1], ARGV[3])
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
func hostKey(roomID string) string     { return "room:" + roomID + ":host" }

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
	err = seedScript.Run(ctx, l.rdb, []string{stateKey(roomID)}, state.Version, doc, int(liveTTL.Seconds())).Err()
	if err != nil {
		return fmt.Errorf("seed room: %w", err)
	}
	return nil
}

// Version returns the room's current version, or false if Redis has none.
func (l *Live) Version(ctx context.Context, roomID string) (int64, bool, error) {
	version, err := l.rdb.HGet(ctx, stateKey(roomID), "version").Int64()
	if errors.Is(err, redis.Nil) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read version: %w", err)
	}
	return version, true, nil
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
			return room.State{}, ErrNoState
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
	UserID    string `json:"userId"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	// Member is true for someone on the room's crew roster.
	Member bool `json:"member,omitempty"`
	// Voice is empty, or listening, muted or live.
	Voice string `json:"voice,omitempty"`
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

// Sockets counts one person's open connections to a room, on every server.
func (l *Live) Sockets(ctx context.Context, roomID, userID string) (int, error) {
	people, err := l.connections(ctx, roomID)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, person := range people {
		if person.UserID == userID {
			count++
		}
	}
	return count, nil
}

func (l *Live) connections(ctx context.Context, roomID string) ([]Person, error) {
	docs, err := l.rdb.HVals(ctx, peopleKey(roomID)).Result()
	if err != nil {
		return nil, err
	}
	people := make([]Person, len(docs))
	for i, doc := range docs {
		if err := json.Unmarshal([]byte(doc), &people[i]); err != nil {
			return nil, err
		}
	}
	return people, nil
}

// People returns everyone present, once each however many tabs they have open.
func (l *Live) People(ctx context.Context, roomID string) ([]Person, error) {
	connected, err := l.connections(ctx, roomID)
	if err != nil {
		return nil, err
	}
	return mergeTabs(connected), nil
}

// mergeTabs folds one person's tabs together. Only one of them is in voice, and
// a tab opened before they joined the crew must not hide that they did.
func mergeTabs(connected []Person) []Person {
	seen := make(map[string]int, len(connected))
	people := make([]Person, 0, len(connected))
	for _, person := range connected {
		at, found := seen[person.UserID]
		if !found {
			seen[person.UserID] = len(people)
			people = append(people, person)
			continue
		}
		if people[at].Voice == "" {
			people[at].Voice = person.Voice
		}
		people[at].Member = people[at].Member || person.Member
	}
	return people
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

// ReportEmbedBlocked records that a person's player refused a video, wherever
// they saw it, and returns how many distinct people have said so. The window is
// fixed from the first report, so a trickle cannot keep it open forever.
func (l *Live) ReportEmbedBlocked(ctx context.Context, source, sourceID, userID string) (int64, error) {
	key := "embed:reports:" + source + ":" + sourceID
	pipe := l.rdb.TxPipeline()
	pipe.SAdd(ctx, key, userID)
	count := pipe.SCard(ctx, key)
	pipe.ExpireNX(ctx, key, embedReportTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return count.Val(), nil
}

// HostSeen records that the host is here, or was until this moment.
func (l *Live) HostSeen(ctx context.Context, roomID, name string, at int64) error {
	key := hostKey(roomID)
	pipe := l.rdb.TxPipeline()
	pipe.HSet(ctx, key, "name", name, "seen", at)
	pipe.Expire(ctx, key, liveTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// HostLastSeen returns the host's name and when they were last here. A room with
// no record, because Redis lost it, starts counting from now.
func (l *Live) HostLastSeen(ctx context.Context, roomID string, now int64) (string, int64, error) {
	key := hostKey(roomID)
	if err := l.rdb.HSetNX(ctx, key, "seen", now).Err(); err != nil {
		return "", 0, err
	}
	fields, err := l.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return "", 0, err
	}
	seen, err := strconv.ParseInt(fields["seen"], 10, 64)
	return fields["name"], seen, err
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

// refundScript leaves an expired window alone: a count with no key behind it
// would start the next window below zero.
var refundScript = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('DECR', KEYS[1])
end
return 1
`)

// Refund hands back what Limit charged, for an attempt that came to nothing.
func (l *Live) Refund(ctx context.Context, key string) error {
	return refundScript.Run(ctx, l.rdb, []string{"limit:" + key}).Err()
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
