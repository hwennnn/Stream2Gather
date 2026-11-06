package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"stream2gather/internal/ids"
	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

// The room has to be busy when the last viewer goes. An idle one takes a queued
// leave at once, which hides a release that closes the room around it.
func TestLastLeaveAlwaysCleansUp(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	for round := range 20 {
		id := r.newRoom(t, directVideo(t))
		c := r.joined(t, id, fmt.Sprintf("u%d", round), room.RoleMember)

		r.hub.mu.Lock()
		busy := r.hub.rooms[id]
		r.hub.mu.Unlock()
		unblock := make(chan struct{})
		busy.do(func() { <-unblock })
		_ = c.ws.CloseNow()
		time.Sleep(20 * time.Millisecond) // The connection unwinds behind the busy room.
		close(unblock)

		eventually(t, "the last viewer's leave was dropped", func() bool {
			people, _ := r.live.People(ctx, id)
			marked, _ := r.rdb.Exists(ctx, "room:"+id+":empty").Result()
			return len(people) == 0 && marked == 1
		})
	}
}

func TestRejoinDuringReleaseStaysSubscribed(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	for range 100 {
		id := ids.New()
		first, err := r.hub.acquire(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		rejoined := make(chan *liveRoom)
		go func() {
			for { // Come back the moment the old room has gone.
				r.hub.mu.Lock()
				_, present := r.hub.rooms[id]
				r.hub.mu.Unlock()
				if !present {
					break
				}
			}
			second, err := r.hub.acquire(ctx, id)
			if err != nil {
				panic(err)
			}
			rejoined <- second
		}()
		r.hub.release(first)
		second := <-rejoined

		listener := &conn{id: "x", out: make(chan []byte, 8), closed: make(chan struct{})}
		second.wait(func() { second.conns[listener] = struct{}{} })
		eventually(t, "the room went deaf after a fast leave and rejoin", func() bool {
			_ = r.live.Publish(ctx, id, []byte(`{"t":"probe"}`))
			select {
			case <-listener.out:
				return true
			default:
				return false
			}
		})
		r.hub.release(second)
	}
}

func TestSilentPeerIsDropped(t *testing.T) {
	r := newRig(t, testRedis, func(h *Hub) { h.idleTimeout = 300 * time.Millisecond })
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "ghost", room.RoleMember)

	select {
	case <-c.closed:
	case <-time.After(waitFor):
		t.Fatal("a silent socket stayed open")
	}
	eventually(t, "a silent peer stayed present", func() bool {
		people, _ := r.live.People(ctx, id)
		return len(people) == 0
	})
}

func TestTalkingPeerIsNotDropped(t *testing.T) {
	r := newRig(t, testRedis, func(h *Hub) { h.idleTimeout = 300 * time.Millisecond })
	c := r.joined(t, r.newRoom(t, directVideo(t)), "alive", room.RoleMember)
	for range 6 {
		time.Sleep(100 * time.Millisecond)
		c.send(t, "ping", map[string]any{"t0": 1})
		c.expect(t, "pong")
	}
}

func TestIdleTimeoutAllowsForThrottledTabs(t *testing.T) {
	if idleTimeout < 90*time.Second {
		t.Fatalf("idle timeout %v would drop hidden tabs, which ping once a minute", idleTimeout)
	}
}

func TestBlockedRoomDoesNotStallOthers(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	slow, fast := r.newRoom(t, directVideo(t)), r.newRoom(t, directVideo(t))
	r.joined(t, slow, "a", room.RoleMember)
	healthy := r.joined(t, fast, "b", room.RoleMember)

	r.hub.mu.Lock()
	blocked := r.hub.rooms[slow]
	r.hub.mu.Unlock()
	release := make(chan struct{})
	defer close(release)
	blocked.do(func() { <-release }) // Stands in for a slow Redis or Postgres call.

	// More than the room can hold, so anything that waits for it would hang.
	const flood = eventBuffer + 500
	pipe := r.rdb.Pipeline()
	for range flood {
		pipe.Publish(ctx, store.Channel(slow), `{"t":"filler"}`)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.live.Publish(ctx, fast, []byte(`{"t":"probe"}`)); err != nil {
		t.Fatal(err)
	}
	if _, ok := healthy.next("probe", 2*time.Second); !ok {
		t.Fatal("one blocked room stalled delivery to another")
	}
	if len(blocked.resync) != 1 {
		t.Fatal("events were lost without asking for a resync")
	}
}

func TestDeliveryDoesNotWaitForSubscribes(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "a", room.RoleMember)

	r.hub.mu.Lock() // A slow Redis subscribe holds this for its whole duration.
	defer r.hub.mu.Unlock()
	if err := r.live.Publish(ctx, id, []byte(`{"t":"probe"}`)); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.next("probe", 2*time.Second); !ok {
		t.Fatal("delivery waited for the hub lock")
	}
}

func TestPongReportsTheVersionInRedis(t *testing.T) {
	p := newProxy(t, testRedis)
	r := newRig(t, p.addr())
	other := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)

	// This server never hears about the change.
	r.hub.mu.Lock()
	room1 := r.hub.rooms[id]
	r.hub.mu.Unlock()
	r.hub.active.Delete(id)
	state := other.apply(t, id, room.Command{Type: room.CmdPause, Item: "item1", Pos: 1, CT: time.Now().UnixMilli()})
	r.hub.active.Store(id, room1)

	c.send(t, "ping", map[string]any{"t0": 1})
	var pong struct {
		Version int64 `json:"version"`
	}
	if err := json.Unmarshal(c.expect(t, "pong").D, &pong); err != nil {
		t.Fatal(err)
	}
	if pong.Version != state.Version {
		t.Fatalf("pong said %d, Redis has %d", pong.Version, state.Version)
	}
}

func TestPubsubGapResyncs(t *testing.T) {
	p := newProxy(t, testRedis)
	r := newRig(t, p.addr())
	other := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)

	// The first confirmation has to be in, or the reconnect looks like the first.
	r.hub.mu.Lock()
	joined := r.hub.rooms[id]
	r.hub.mu.Unlock()
	eventually(t, "never subscribed", joined.subscribed.Load)

	p.cut()
	state := other.apply(t, id, room.Command{
		Type: room.CmdQueueAdd, NewItemID: "item2", Media: &room.Media{Source: "direct", SourceID: "y", Title: "b"},
	})
	p.restore()

	message, ok := c.next("state", 10*time.Second)
	if !ok {
		t.Fatal("no snapshot after the pub/sub connection came back")
	}
	got := decodeState(t, message)
	if got.Cause != causeSync || got.Version != state.Version || len(got.Queue) != 2 {
		t.Fatalf("snapshot = %+v, want version %d with both videos", got, state.Version)
	}
}

func TestRedisStateLossRehydrates(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	c := r.dial(t, id, "u", room.RoleMember)
	var welcome struct {
		State room.State `json:"state"`
	}
	if err := json.Unmarshal(c.expect(t, "welcome").D, &welcome); err != nil {
		t.Fatal(err)
	}
	if err := r.db.SaveSnapshot(ctx, id, welcome.State); err != nil {
		t.Fatal(err)
	}
	if err := r.rdb.Del(ctx, "room:"+id+":state").Err(); err != nil {
		t.Fatal(err)
	}

	c.send(t, room.CmdPause, map[string]any{"item": "item1", "pos": 1.0, "ct": time.Now().UnixMilli()})

	snapshot := decodeState(t, c.expect(t, "state"))
	if snapshot.Cause != causeSync || snapshot.Version <= welcome.State.Version {
		t.Fatalf("snapshot %+v after version %d: viewers would ignore every later event", snapshot, welcome.State.Version)
	}
	if snapshot.Playback.Status != room.StatusPlaying {
		t.Fatalf("a room people are watching paused itself: %+v", snapshot.Playback)
	}
	pause := decodeState(t, c.expect(t, "playback"))
	if pause.Version != snapshot.Version+1 || pause.Playback.Status != room.StatusPaused {
		t.Fatalf("pause = %+v, snapshot version %d", pause, snapshot.Version)
	}
}

func TestRehydratingAnEmptyRoomLeavesItPaused(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	state, _, _ := r.live.Load(ctx, id)
	if err := r.db.SaveSnapshot(ctx, id, state); err != nil {
		t.Fatal(err)
	}
	if err := r.rdb.Del(ctx, "room:"+id+":state").Err(); err != nil {
		t.Fatal(err)
	}
	c := r.dial(t, id, "u", room.RoleMember)
	var welcome struct {
		State room.State `json:"state"`
	}
	if err := json.Unmarshal(c.expect(t, "welcome").D, &welcome); err != nil {
		t.Fatal(err)
	}
	if welcome.State.Playback.Status != room.StatusPaused || len(welcome.State.Queue) != 1 {
		t.Fatalf("welcome = %+v", welcome.State)
	}
}

func TestFractionalClientTimeIsAccepted(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	ct := fmt.Sprintf("%d.5", time.Now().UnixMilli())
	body := `{"t":"pause","id":"1","d":{"item":"item1","pos":3.2,"ct":` + ct + `}}`
	if err := c.ws.Write(context.Background(), websocket.MessageText, []byte(body)); err != nil {
		t.Fatal(err)
	}
	if got := decodeState(t, c.expect(t, "playback")); got.Playback.Status != room.StatusPaused {
		t.Fatalf("playback = %+v", got)
	}
}

func TestLastVideoEndingClearsTheQueueOnTheWire(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	c.send(t, room.CmdSkip, map[string]any{"item": "item1"})
	message := c.expect(t, "state")
	if !strings.Contains(string(message.D), `"queue":[]`) {
		t.Fatalf("state = %s", message.D)
	}
}

func TestStatusIsAllowlisted(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	a := r.joined(t, id, "a", room.RoleMember)
	b := r.joined(t, id, "b", room.RoleMember)

	for _, state := range []string{"__proto__", "constructor", "unavailable", ""} {
		a.send(t, "status", map[string]any{"state": state})
	}
	a.send(t, "status", map[string]any{"state": "stalled"})
	var got struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(b.expect(t, "member.status").D, &got); err != nil {
		t.Fatal(err)
	}
	if got.State != "stalled" {
		t.Fatalf("relayed %q", got.State)
	}
}

func TestMemberCannotEndAVideoOfUnknownLength(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	state := directVideo(t)
	state.Settings = room.Settings{ControlMode: room.ModeHosts, QueueMode: room.ModeHosts}
	id := r.newRoom(t, state)
	r.joined(t, id, "host", room.RoleHost) // A present host keeps the lock on.
	m := r.joined(t, id, "m", room.RoleMember)

	m.send(t, room.CmdEnded, map[string]any{"item": "item1"})
	if message, ok := m.next("error", 300*time.Millisecond); ok {
		t.Fatalf("every member would see this when a video ends: %s", message.D)
	}
	after, _, _ := r.live.Load(ctx, id)
	if len(after.Queue) != 1 {
		t.Fatalf("queue = %+v", after.Queue)
	}
}

func TestStaleRequestStillGetsAnAnswer(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	c.sendWithID(t, "7", room.CmdQueueRemove, map[string]any{"target": "gone"})
	var failure struct {
		Re   string `json:"re"`
		Code string `json:"code"`
	}
	if err := json.Unmarshal(c.expect(t, "error").D, &failure); err != nil {
		t.Fatal(err)
	}
	if failure.Re != "7" || failure.Code != "stale" {
		t.Fatalf("failure = %+v", failure)
	}
}

func TestStaleCommandWithoutAnIDStaysQuiet(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	c.send(t, room.CmdPause, map[string]any{"item": "old", "pos": 1, "ct": 1})
	if got := decodeState(t, c.expect(t, "state")); got.Cause != causeSync {
		t.Fatalf("got %+v", got)
	}
	if message, ok := c.next("error", 200*time.Millisecond); ok {
		t.Fatalf("got %s", message.D)
	}
}

func TestSyncRequestReturnsASnapshot(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	c.send(t, "sync", nil)
	if got := decodeState(t, c.expect(t, "state")); got.Cause != causeSync || len(got.Queue) != 1 {
		t.Fatalf("snapshot = %+v", got)
	}
}

func TestQueueAddHonoursItsMode(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)
	for i, mode := range []string{"end", "next"} {
		c.sendWithID(t, fmt.Sprint(i), room.CmdQueueAdd, map[string]any{
			"url": fmt.Sprintf("https://a.test/%s.mp4", mode), "mode": mode,
		})
		c.expect(t, "ack")
	}
	state, _, _ := r.live.Load(context.Background(), id)
	if len(state.Queue) != 3 || state.Queue[1].Title != "next.mp4" || state.Queue[2].Title != "end.mp4" {
		t.Fatalf("queue = %+v", state.Queue)
	}
}

func TestChatIsAcknowledged(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	c.sendWithID(t, "3", "chat.send", map[string]any{"text": "hi"})
	c.expect(t, "ack")
}

func youtubeVideo(t *testing.T, r *rig, sourceID string) room.State {
	t.Helper()
	media := room.Media{Source: "youtube", SourceID: sourceID, URL: "https://www.youtube.com/watch?v=" + sourceID, Title: "Zelda trailer"}
	if err := r.db.PutMedia(context.Background(), []room.Media{media}); err != nil {
		t.Fatal(err)
	}
	return withVideo(t, media)
}

func noticeOf(t *testing.T, message frame) map[string]string {
	t.Helper()
	var notice map[string]string
	if err := json.Unmarshal(message.D, &notice); err != nil {
		t.Fatal(err)
	}
	return notice
}

func TestOneReportCannotBlacklistAVideo(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	sourceID := "t" + ids.New()

	first := r.joined(t, r.newRoom(t, youtubeVideo(t, r, sourceID)), "first", room.RoleMember)
	first.send(t, "media_error", map[string]any{"item": "item1", "code": 150})
	notice := noticeOf(t, first.expect(t, "notice"))
	if notice["text"] != "Skipped “Zelda trailer” because YouTube won’t let it play here." || notice["url"] == "" {
		t.Fatalf("notice = %+v", notice)
	}
	if blocked, _ := r.db.EmbedBlocked(ctx, "youtube", []string{sourceID}); blocked[sourceID] {
		t.Fatal("one guest blacklisted a video for the whole site")
	}

	// The same person in another room is still one person.
	again := r.joined(t, r.newRoom(t, youtubeVideo(t, r, sourceID)), "first", room.RoleMember)
	again.send(t, "media_error", map[string]any{"item": "item1", "code": 150})
	again.expect(t, "notice")
	if blocked, _ := r.db.EmbedBlocked(ctx, "youtube", []string{sourceID}); blocked[sourceID] {
		t.Fatal("one person reporting twice counted as two")
	}

	second := r.joined(t, r.newRoom(t, youtubeVideo(t, r, sourceID)), "second", room.RoleMember)
	second.send(t, "media_error", map[string]any{"item": "item1", "code": 101})
	second.expect(t, "notice")
	if blocked, _ := r.db.EmbedBlocked(ctx, "youtube", []string{sourceID}); !blocked[sourceID] {
		t.Fatal("two people across rooms did not block it")
	}
	if ttl, _ := r.rdb.TTL(ctx, "embed:reports:youtube:"+sourceID).Result(); ttl <= 0 || ttl > 7*24*time.Hour {
		t.Fatalf("report ttl = %v", ttl)
	}
}

func TestEmbedBlockExpires(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	sourceID := "t" + ids.New()
	youtubeVideo(t, r, sourceID)
	if err := r.db.MarkEmbedBlocked(ctx, "youtube", sourceID); err != nil {
		t.Fatal(err)
	}
	if blocked, _ := r.db.EmbedBlocked(ctx, "youtube", []string{sourceID}); !blocked[sourceID] {
		t.Fatal("fresh block not seen")
	}
	if _, err := r.pool.Exec(ctx, `UPDATE media SET embed_blocked_at = now() - interval '8 days' WHERE source_id = $1`, sourceID); err != nil {
		t.Fatal(err)
	}
	if blocked, _ := r.db.EmbedBlocked(ctx, "youtube", []string{sourceID}); blocked[sourceID] {
		t.Fatal("a block outlived seven days")
	}
	if err := r.db.PutSearch(ctx, "youtube", "q"+sourceID, "", []string{sourceID}); err != nil {
		t.Fatal(err)
	}
	items, found, err := r.db.CachedSearch(ctx, "youtube", "q"+sourceID, "", time.Hour)
	if err != nil || !found || len(items) != 1 {
		t.Fatalf("expired block still hides cached search: %v %v %v", items, found, err)
	}
}

func TestSkipNoticeForAnythingElse(t *testing.T) {
	r := newRig(t, testRedis)
	c := r.joined(t, r.newRoom(t, directVideo(t)), "u", room.RoleMember)
	// 150 from a file player is a media error code, not YouTube refusing.
	c.send(t, "media_error", map[string]any{"item": "item1", "code": 150})
	notice := noticeOf(t, c.expect(t, "notice"))
	if notice["text"] != "Skipped “a” because it wouldn’t load." {
		t.Fatalf("text = %q", notice["text"])
	}
	if _, present := notice["url"]; present {
		t.Fatalf("only YouTube items carry a link: %+v", notice)
	}
}

func TestMediaErrorsAreRateLimited(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	bystander := r.joined(t, id, "bystander1", room.RoleMember)
	r.joined(t, id, "bystander2", room.RoleMember)
	c := r.joined(t, id, "spammer", room.RoleMember)
	for range 50 {
		c.send(t, "media_error", map[string]any{"item": "item1", "code": 4})
	}
	c.send(t, "ping", map[string]any{"t0": 1})
	c.expect(t, "pong")

	relayed := 0
	for {
		if _, ok := bystander.next("member.status", 200*time.Millisecond); !ok {
			break
		}
		relayed++
	}
	if relayed == 0 || relayed > 3 {
		t.Fatalf("relayed %d of 50 reports", relayed)
	}
}

func TestReportsRacingToSkipAnnounceOnce(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	tab := r.joined(t, id, "a", room.RoleMember)
	other := r.joined(t, id, "a", room.RoleMember)

	// Both reports see the video as current and both queue a skip.
	r.hub.mu.Lock()
	busy := r.hub.rooms[id]
	r.hub.mu.Unlock()
	unblock := make(chan struct{})
	busy.do(func() { <-unblock })
	tab.send(t, "media_error", map[string]any{"item": "item1", "code": 4})
	other.send(t, "media_error", map[string]any{"item": "item1", "code": 4})
	time.Sleep(100 * time.Millisecond)
	close(unblock)

	tab.expect(t, "notice")
	if message, ok := tab.next("notice", 400*time.Millisecond); ok {
		t.Fatalf("second notice: %s", message.D)
	}
}

func TestHubCloseSendsGoingAwayAndRunsLeaves(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	c := r.joined(t, id, "u", room.RoleMember)
	state := r.apply(t, id, room.Command{Type: room.CmdPause, Item: "item1", Pos: 42, CT: time.Now().UnixMilli()})

	closing, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := r.hub.Close(closing); err != nil {
		t.Fatal(err)
	}

	select {
	case code := <-c.closed:
		if code != websocket.StatusGoingAway {
			t.Fatalf("closed with %v", code)
		}
	case <-time.After(waitFor):
		t.Fatal("socket stayed open")
	}
	if people, _ := r.live.People(ctx, id); len(people) != 0 {
		t.Fatalf("leave did not run: %+v", people)
	}
	saved, err := r.db.LoadSnapshot(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version != state.Version {
		t.Fatalf("saved version %d, want %d", saved.Version, state.Version)
	}

	// Anyone arriving now is told to go elsewhere, not left waiting.
	late := r.dial(t, id, "late", room.RoleMember)
	select {
	case code := <-late.closed:
		if code != websocket.StatusGoingAway {
			t.Fatalf("late joiner closed with %v", code)
		}
	case <-time.After(waitFor):
		t.Fatal("late joiner stayed open")
	}
}

func TestSocketCapPerPerson(t *testing.T) {
	r := newRig(t, testRedis)
	id := r.newRoom(t, directVideo(t))
	for range maxSocketsPerUser {
		r.joined(t, id, "tabby", room.RoleMember)
	}
	extra := r.dial(t, id, "tabby", room.RoleMember)
	select {
	case code := <-extra.closed:
		if code != websocket.StatusPolicyViolation {
			t.Fatalf("closed with %v", code)
		}
	case <-time.After(waitFor):
		t.Fatal("eleventh socket was kept")
	}
	r.joined(t, id, "someone-else", room.RoleMember)
}

func TestRenameUpdatesPresenceAndOtherTabs(t *testing.T) {
	r := newRig(t, testRedis)
	ctx := context.Background()
	id := r.newRoom(t, directVideo(t))
	tab := r.joined(t, id, "u", room.RoleMember)
	other := r.joined(t, id, "u", room.RoleMember)
	watcher := r.joined(t, id, "w", room.RoleMember)

	tab.sendWithID(t, "1", "rename", map[string]any{"name": "Maya"})
	tab.expect(t, "ack")
	watcher.expectWhere(t, "members", func(raw json.RawMessage) bool { return strings.Contains(string(raw), "Maya") })
	eventually(t, "presence kept the old name", func() bool {
		people, _ := r.live.People(ctx, id)
		for _, person := range people {
			if person.UserID == "u" {
				return person.Name == "Maya"
			}
		}
		return false
	})

	// A chat from the other tab now carries the new name.
	other.sendWithID(t, "2", "chat.send", map[string]any{"text": "hello"})
	message := watcher.expect(t, "chat")
	if !strings.Contains(string(message.D), "Maya") {
		t.Fatalf("chat = %s", message.D)
	}

	tab.sendWithID(t, "3", "rename", map[string]any{"name": "bad\x00name"})
	var failure struct {
		Re string `json:"re"`
	}
	if err := json.Unmarshal(tab.expect(t, "error").D, &failure); err != nil || failure.Re != "3" {
		t.Fatalf("failure = %+v, %v", failure, err)
	}
}

func fastHost(h *Hub) {
	h.hostGrace = 300 * time.Millisecond
	h.touchEvery = 50 * time.Millisecond
}

func TestOrphanedRoomUnlocksOnceAcrossServersAndRelocks(t *testing.T) {
	one, two := newRig(t, testRedis, fastHost), newRig(t, testRedis, fastHost)
	ctx := context.Background()
	state := directVideo(t)
	state.Settings = room.Settings{ControlMode: room.ModeHosts, QueueMode: room.ModeHosts}
	id := one.newRoom(t, state)

	host := one.joined(t, id, "Maya", room.RoleHost)
	viewers := []*client{one.joined(t, id, "a", room.RoleMember), two.joined(t, id, "b", room.RoleMember)}
	if message, ok := viewers[0].next("notice", 500*time.Millisecond); ok {
		t.Fatalf("a present host lost the lock: %s", message.D)
	}

	_ = host.ws.CloseNow()
	started := time.Now()
	for _, viewer := range viewers {
		if got := noticeOf(t, viewer.expect(t, "notice"))["text"]; got != "Maya left, so anyone can control playback." {
			t.Fatalf("notice = %q", got)
		}
	}
	if elapsed := time.Since(started); elapsed < 250*time.Millisecond {
		t.Fatalf("released after %v, before the grace period", elapsed)
	}
	if message, ok := viewers[1].next("notice", 300*time.Millisecond); ok {
		t.Fatalf("second server announced it too: %s", message.D)
	}
	released, _, _ := one.live.Load(ctx, id)
	if released.Settings.Locked() {
		t.Fatalf("settings = %+v", released.Settings)
	}

	one.joined(t, id, "Maya", room.RoleHost)
	viewers[1].expectWhere(t, "state", func(raw json.RawMessage) bool {
		return strings.Contains(string(raw), `"controlMode":"hosts"`)
	})
	restored, _, _ := one.live.Load(ctx, id)
	if restored.Settings != state.Settings || restored.Held != nil {
		t.Fatalf("restored = %+v", restored)
	}
}

func TestTwoServersReleasingAtOnceAnnounceOnce(t *testing.T) {
	one, two := newRig(t, testRedis), newRig(t, testRedis)
	ctx := context.Background()
	id := one.newRoom(t, directVideo(t))
	viewer := one.joined(t, id, "a", room.RoleMember)
	two.joined(t, id, "b", room.RoleMember)

	roomOf := func(r *rig) *liveRoom {
		r.hub.mu.Lock()
		defer r.hub.mu.Unlock()
		return r.hub.rooms[id]
	}
	first, second := roomOf(one), roomOf(two)
	longAgo := time.Now().Add(-time.Hour).UnixMilli()
	locked := room.Settings{ControlMode: room.ModeHosts, QueueMode: room.ModeHosts}

	for round := range 30 {
		one.apply(t, id, room.Command{Type: room.CmdSettings, Settings: &locked})
		if err := one.live.HostSeen(ctx, id, "Maya", longAgo); err != nil {
			t.Fatal(err)
		}
		finished := make(chan struct{}, 2)
		for _, r := range []*liveRoom{first, second} {
			go func() {
				r.wait(func() { r.settleHost(ctx) })
				finished <- struct{}{}
			}()
		}
		<-finished
		<-finished
		viewer.expect(t, "notice")
		if message, ok := viewer.next("notice", 30*time.Millisecond); ok {
			t.Fatalf("round %d: announced twice: %s", round, message.D)
		}
	}
}

func TestHostReloadKeepsTheLock(t *testing.T) {
	r := newRig(t, testRedis, fastHost)
	state := directVideo(t)
	state.Settings = room.Settings{ControlMode: room.ModeHosts, QueueMode: room.ModeHosts}
	id := r.newRoom(t, state)
	host := r.joined(t, id, "Maya", room.RoleHost)
	viewer := r.joined(t, id, "a", room.RoleMember)
	_ = host.ws.CloseNow()
	time.Sleep(100 * time.Millisecond)
	r.joined(t, id, "Maya", room.RoleHost)
	if message, ok := viewer.next("notice", 600*time.Millisecond); ok {
		t.Fatalf("a reload released the lock: %s", message.D)
	}
}
