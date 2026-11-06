package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"stream2gather/internal/auth"
	"stream2gather/internal/hub"
	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
	"stream2gather/internal/testenv"
)

// ghosts leaves connections behind the way a server that died does.
func ghosts(t *testing.T, roomID string, people ...store.Person) {
	t.Helper()
	ctx := context.Background()
	rdb := redis.NewClient(&redis.Options{Addr: testenv.RedisAddr()})
	t.Cleanup(func() { _ = rdb.Close() })
	lastSeen := time.Now().Add(-5 * time.Minute).UnixMilli()
	for _, person := range people {
		conn := ids.New()
		doc, err := json.Marshal(person)
		if err != nil {
			t.Fatal(err)
		}
		if err := rdb.ZAdd(ctx, "room:"+roomID+":presence", redis.Z{Score: float64(lastSeen), Member: conn}).Err(); err != nil {
			t.Fatal(err)
		}
		if err := rdb.HSet(ctx, "room:"+roomID+":people", conn, doc).Err(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestACrashDoesNotLockAnyoneOutOfARoom(t *testing.T) {
	s, _ := stackServer(t)
	record := newRoom(t, s, room.New())
	var crowd []store.Person
	for range 60 {
		crowd = append(crowd, store.Person{UserID: "g_" + ids.New(), Name: "Gone"})
	}
	ghosts(t, record.ID, crowd...)

	recorder, body := serve(s, http.MethodPost, "/v1/rooms/"+record.Slug+"/ticket", "{}", from("203.0.113."+ids.New()))
	if recorder.Code != http.StatusOK {
		t.Fatalf("a stranger: status %d, %v", recorder.Code, body)
	}
}

func TestACrashDoesNotUseUpSomeonesTabs(t *testing.T) {
	s, _ := stackServer(t)
	record := newRoom(t, s, room.New())
	tabs := make([]store.Person, hub.MaxSocketsPerUser)
	for i := range tabs {
		tabs[i] = store.Person{UserID: record.OwnerID, Name: "Owner", Role: room.RoleHost}
	}
	ghosts(t, record.ID, tabs...)

	cookie := signedIn(t, s, auth.Claims{Subject: record.OwnerID, Name: "Owner"})
	recorder, body := serve(s, http.MethodPost, "/v1/rooms/"+record.Slug+"/ticket", "{}", cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("the owner: status %d, %v", recorder.Code, body)
	}
}

func TestPreviewDoesNotListACrashedServersViewers(t *testing.T) {
	s, _ := stackServer(t)
	record := newRoom(t, s, room.New())
	ghosts(t, record.ID, store.Person{UserID: "g_" + ids.New(), Name: "Gone"})

	_, body := serve(s, http.MethodGet, "/v1/rooms/"+record.Slug, "")
	if members, _ := body["members"].([]any); len(members) != 0 {
		t.Fatalf("members = %v", members)
	}
}
