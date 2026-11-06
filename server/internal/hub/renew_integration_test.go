package hub

import (
	"context"
	"encoding/json"
	"testing"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
)

// keptRoom is a crew room whose saved queue holds an old title.
func keptRoom(t *testing.T, r *rig, media room.Media, crew bool) string {
	t.Helper()
	id := r.newRoom(t, withVideo(t, media))
	if crew {
		_, err := r.pool.Exec(context.Background(), `INSERT INTO crews (id, room_id, invite_token) VALUES ($1, $2, $3)`, ids.New(), id, ids.New())
		if err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func welcomed(t *testing.T, c *client) room.State {
	t.Helper()
	var welcome struct {
		State room.State `json:"state"`
	}
	if err := json.Unmarshal(c.expect(t, "welcome").D, &welcome); err != nil {
		t.Fatal(err)
	}
	return welcome.State
}

func TestFirstJoinOfACrewRoomRenewsItsTitles(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	old := room.Media{Source: "test", SourceID: ids.New(), URL: "https://a.test/a", Title: "Old title"}
	id := keptRoom(t, r, old, true)
	renamed := old
	renamed.Title = "New title"
	if err := r.db.PutMedia(ctx, []room.Media{renamed}); err != nil {
		t.Fatal(err)
	}

	state := welcomed(t, r.dial(t, id, "u_"+ids.New(), room.RoleMember))
	if len(state.Queue) != 1 || state.Queue[0].Title != "New title" {
		t.Fatalf("queue = %+v", state.Queue)
	}
}

func TestFirstJoinDropsAVideoWhoseMetadataHasGone(t *testing.T) {
	r := newRig(t, testRedis)
	id := keptRoom(t, r, room.Media{Source: "test", SourceID: ids.New(), Title: "Gone"}, true)

	state := welcomed(t, r.dial(t, id, "u_"+ids.New(), room.RoleMember))
	if len(state.Queue) != 0 || state.Playback.Status != room.StatusIdle {
		t.Fatalf("state = %+v", state)
	}
}

func TestRoomWithoutACrewKeepsItsQueueAsItWas(t *testing.T) {
	r := newRig(t, testRedis)
	id := keptRoom(t, r, room.Media{Source: "test", SourceID: ids.New(), Title: "Mine"}, false)

	state := welcomed(t, r.dial(t, id, "u_"+ids.New(), room.RoleMember))
	if len(state.Queue) != 1 || state.Queue[0].Title != "Mine" {
		t.Fatalf("queue = %+v", state.Queue)
	}
}
