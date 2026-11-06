package hub

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
	"stream2gather/internal/testenv"
)

// This test needs the stack from deploy/compose.yaml and skips without it.
func TestWelcomeArrivesBeforeAnyPong(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, testenv.PostgresURL())
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(pool.Close)
	rdb := redis.NewClient(&redis.Options{Addr: testenv.RedisAddr()})
	t.Cleanup(func() { _ = rdb.Close() })
	if pool.Ping(ctx) != nil || rdb.Ping(ctx).Err() != nil {
		t.Skip("stack not running")
	}

	db := store.NewPostgres(pool)
	owner, roomID := "g_"+ids.New(), ids.New()
	if err := db.EnsureUser(ctx, owner, "Ada"); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateRoom(ctx, store.Room{ID: roomID, Slug: ids.New(), Name: "Room", OwnerID: owner}); err != nil {
		t.Fatal(err)
	}

	h := New(db, store.NewLive(rdb), rdb, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	go h.Run(ctx)

	ticket := store.Ticket{RoomID: roomID, Person: store.Person{UserID: owner, Name: "Ada", Role: room.RoleHost}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer ws.CloseNow()
		h.Serve(context.WithoutCancel(r.Context()), ws, ticket)
	}))
	defer server.Close()

	for attempt := range 25 {
		ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := ws.Write(ctx, websocket.MessageText, []byte(`{"t":"ping","d":{"t0":1}}`)); err != nil {
			t.Fatal(err)
		}
		_, payload, err := ws.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var first Message
		if err := json.Unmarshal(payload, &first); err != nil {
			t.Fatal(err)
		}
		if first.Type != "welcome" {
			t.Fatalf("attempt %d: first message was %q", attempt, first.Type)
		}
		_ = ws.Close(websocket.StatusNormalClosure, "")
	}
}
