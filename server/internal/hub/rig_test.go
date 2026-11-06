package hub

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/source"
	"stream2gather/internal/store"
	"stream2gather/internal/testenv"
)

// These tests need the stack from deploy/compose.yaml and skip without it.
const (
	testPostgres = "postgres://s2g:s2g@127.0.0.1:54339/s2g?sslmode=disable"
	waitFor      = 3 * time.Second
)

var testRedis = testenv.RedisAddr()

// rig is one server: a hub with its own Redis connection and HTTP listener.
type rig struct {
	hub    *Hub
	live   *store.Live
	db     *store.Postgres
	pool   *pgxpool.Pool
	rdb    *redis.Client
	server *httptest.Server
}

func newRig(t *testing.T, redisAddr string, tune ...func(*Hub)) *rig {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	pool, err := pgxpool.New(ctx, testPostgres)
	if err != nil {
		t.Skip(err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	if pool.Ping(ctx) != nil || rdb.Ping(ctx).Err() != nil {
		cancel()
		t.Skip("stack not running")
	}

	db := store.NewPostgres(pool)
	live := store.NewLive(rdb)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := New(db, live, rdb, source.NewCatalog(db, 0, log, source.Direct{}), log)
	for _, change := range tune {
		change(h)
	}
	go h.Run(ctx)

	r := &rig{hub: h, live: live, db: db, pool: pool, rdb: rdb}
	r.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var ticket store.Ticket
		_ = json.Unmarshal([]byte(req.URL.Query().Get("ticket")), &ticket)
		ws, err := websocket.Accept(w, req, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer ws.CloseNow()
		h.Serve(context.WithoutCancel(req.Context()), ws, ticket)
	}))
	t.Cleanup(func() {
		r.server.CloseClientConnections()
		r.server.Close()
		cancel()
		pool.Close()
		_ = rdb.Close()
	})
	return r
}

func (r *rig) newRoom(t *testing.T, state room.State) string {
	t.Helper()
	ctx := context.Background()
	owner := "g_" + ids.New()
	if err := r.db.EnsureUser(ctx, owner, "Owner"); err != nil {
		t.Fatal(err)
	}
	id := ids.New()
	if err := r.db.CreateRoom(ctx, store.Room{ID: id, Slug: id, Name: "Room", OwnerID: owner}); err != nil {
		t.Fatal(err)
	}
	if err := r.live.Seed(ctx, id, state); err != nil {
		t.Fatal(err)
	}
	return id
}

// apply changes a room from outside any hub, the way another server would.
func (r *rig) apply(t *testing.T, roomID string, cmd room.Command) room.State {
	t.Helper()
	var change room.Change
	state, err := r.live.Mutate(context.Background(), roomID,
		func(s room.State) (room.State, error) {
			next, applied, err := room.Apply(s, room.Actor{ID: "x", Name: "Other", Role: room.RoleHost}, cmd, time.Now().UnixMilli())
			change = applied
			return next, err
		},
		func(s room.State) ([]byte, error) { return encodeChange(s, change), nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func withVideo(t *testing.T, media room.Media) room.State {
	t.Helper()
	state, _, err := room.Apply(room.New(), room.Actor{ID: "h", Role: room.RoleHost}, room.Command{
		Type: room.CmdQueueAdd, NewItemID: "item1", Media: &media,
	}, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func directVideo(t *testing.T) room.State {
	t.Helper()
	return withVideo(t, room.Media{Source: "direct", SourceID: "x", URL: "https://a.test/a.mp4", Title: "a"})
}

type frame struct {
	T string          `json:"t"`
	D json.RawMessage `json:"d"`
}

type client struct {
	ws     *websocket.Conn
	in     chan frame
	closed chan websocket.StatusCode
}

func (r *rig) dial(t *testing.T, roomID, userID, role string) *client {
	t.Helper()
	if err := r.db.EnsureUser(context.Background(), userID, userID); err != nil {
		t.Fatal(err)
	}
	ticket, _ := json.Marshal(store.Ticket{
		RoomID: roomID, RoomSlug: roomID, RoomName: "Room",
		Person: store.Person{UserID: userID, Name: userID, Role: role},
	})
	address := "ws" + strings.TrimPrefix(r.server.URL, "http") + "?ticket=" + url.QueryEscape(string(ticket))
	ws, _, err := websocket.Dial(context.Background(), address, nil)
	if err != nil {
		t.Fatal(err)
	}
	ws.SetReadLimit(1 << 22)
	c := &client{ws: ws, in: make(chan frame, 8192), closed: make(chan websocket.StatusCode, 1)}
	t.Cleanup(func() { _ = ws.CloseNow() })
	go func() {
		for {
			_, payload, err := ws.Read(context.Background())
			if err != nil {
				c.closed <- websocket.CloseStatus(err)
				return
			}
			var message frame
			if json.Unmarshal(payload, &message) == nil {
				c.in <- message
			}
		}
	}()
	return c
}

// joined is dial, returning once the welcome has arrived.
func (r *rig) joined(t *testing.T, roomID, userID, role string) *client {
	t.Helper()
	c := r.dial(t, roomID, userID, role)
	c.expect(t, "welcome")
	return c
}

func (c *client) send(t *testing.T, kind string, data any) {
	t.Helper()
	c.sendWithID(t, "", kind, data)
}

func (c *client) sendWithID(t *testing.T, id, kind string, data any) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"t": kind, "id": id, "d": data})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.ws.Write(context.Background(), websocket.MessageText, body); err != nil {
		t.Fatal(err)
	}
}

// next returns the next frame of this kind, or false after d.
func (c *client) next(kind string, d time.Duration) (frame, bool) {
	deadline := time.After(d)
	for {
		select {
		case message := <-c.in:
			if message.T == kind {
				return message, true
			}
		case <-deadline:
			return frame{}, false
		}
	}
}

func (c *client) expect(t *testing.T, kind string) frame {
	t.Helper()
	message, ok := c.next(kind, waitFor)
	if !ok {
		t.Fatalf("no %s frame", kind)
	}
	return message
}

// expectWhere waits for a frame of this kind that passes the check.
func (c *client) expectWhere(t *testing.T, kind string, match func(json.RawMessage) bool) frame {
	t.Helper()
	deadline := time.Now().Add(waitFor)
	for time.Now().Before(deadline) {
		if message, ok := c.next(kind, time.Until(deadline)); ok && match(message.D) {
			return message
		}
	}
	t.Fatalf("no matching %s frame", kind)
	return frame{}
}

func eventually(t *testing.T, what string, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(waitFor)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(what)
}

func decodeState(t *testing.T, message frame) (out struct {
	Version  int64         `json:"version"`
	Playback room.Playback `json:"playback"`
	Queue    []room.Item   `json:"queue"`
	Settings room.Settings `json:"settings"`
	Cause    string        `json:"cause"`
}) {
	t.Helper()
	if err := json.Unmarshal(message.D, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// proxy is a TCP proxy that can be cut, so failures never touch the shared stack.
type proxy struct {
	listener net.Listener
	mu       sync.Mutex
	conns    map[net.Conn]struct{}
	down     bool
}

func newProxy(t *testing.T, target string) *proxy {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &proxy{listener: listener, conns: map[net.Conn]struct{}{}}
	go func() {
		for {
			down, err := listener.Accept()
			if err != nil {
				return
			}
			p.mu.Lock()
			refused := p.down
			p.mu.Unlock()
			up, err := net.Dial("tcp", target)
			if refused || err != nil {
				_ = down.Close()
				continue
			}
			p.mu.Lock()
			p.conns[down], p.conns[up] = struct{}{}, struct{}{}
			p.mu.Unlock()
			go func() { _, _ = io.Copy(up, down); _ = up.Close() }()
			go func() { _, _ = io.Copy(down, up); _ = down.Close() }()
		}
	}()
	t.Cleanup(func() { _ = listener.Close(); p.cut() })
	return p
}

func (p *proxy) addr() string { return p.listener.Addr().String() }

// cut drops every connection and refuses new ones until restore.
func (p *proxy) cut() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.down = true
	for c := range p.conns {
		_ = c.Close()
	}
	p.conns = map[net.Conn]struct{}{}
}

func (p *proxy) restore() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.down = false
}
