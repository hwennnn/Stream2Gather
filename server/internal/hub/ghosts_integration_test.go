package hub

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// crashed leaves connections behind the way a server that died does.
func crashed(t *testing.T, r *rig, roomID string, lastSeen time.Time, people ...store.Person) {
	t.Helper()
	ctx := context.Background()
	for _, person := range people {
		conn := ids.New()
		doc, err := json.Marshal(person)
		if err != nil {
			t.Fatal(err)
		}
		if err := r.rdb.ZAdd(ctx, "room:"+roomID+":presence", redis.Z{Score: float64(lastSeen.UnixMilli()), Member: conn}).Err(); err != nil {
			t.Fatal(err)
		}
		if err := r.rdb.HSet(ctx, "room:"+roomID+":people", conn, doc).Err(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestARoomACrashLeftRunningPicksUpWhereTheViewersWent(t *testing.T) {
	r := newRig(t, testRedis)
	state := directVideo(t)
	state.Playback.At = time.Now().Add(-10 * time.Minute).UnixMilli()
	id := r.newRoom(t, state)
	crashed(t, r, id, time.Now().Add(-5*time.Minute), store.Person{UserID: "gone", Name: "Gone", Role: room.RoleHost})

	c := r.dial(t, id, "u", room.RoleMember)
	var welcome struct {
		State   room.State     `json:"state"`
		Members []store.Person `json:"members"`
	}
	if err := json.Unmarshal(c.expect(t, "welcome").D, &welcome); err != nil {
		t.Fatal(err)
	}
	if welcome.State.Playback.Status != room.StatusPlaying {
		t.Fatalf("playback = %+v: the first person back should set it going", welcome.State.Playback)
	}
	if pos := welcome.State.Playback.Pos; pos < 295 || pos > 305 {
		t.Fatalf("resumed at %v, want about 300: five minutes in, when the viewers went", pos)
	}
	if len(welcome.Members) != 1 {
		t.Fatalf("members = %+v: the crashed server's viewer is still listed", welcome.Members)
	}
}

func TestAStalledRedisDoesNotPauseARoomPeopleAreWatching(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	r.joined(t, id, "here", room.RoleMember)

	// A stall looks like an empty room to the first thing that checks.
	if err := r.live.MarkEmpty(context.Background(), id, time.Now().Add(-5*time.Minute).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	c := r.dial(t, id, "late", room.RoleMember)
	var welcome struct {
		State room.State `json:"state"`
	}
	if err := json.Unmarshal(c.expect(t, "welcome").D, &welcome); err != nil {
		t.Fatal(err)
	}
	if welcome.State.Playback.Status != room.StatusPlaying {
		t.Fatalf("playback = %+v: the room paused under a connected viewer", welcome.State.Playback)
	}
}
