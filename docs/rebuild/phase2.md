# Stream2Gather Phase 2: from a room link to a place a friend group returns to

Status: spec, not started. Written 2026-11-05 against `rebuild/go-platform` while other work was in flight.
Audience: friend groups and long-distance couples. No monetization work.

Markers, as in `plan.md`: **[V]** verified in this repo, by a local spike, or in official docs fetched 2026-11-05. **[U]** not verified, treat as a hypothesis. All [U] items are collected in section 11, and owner decisions in section 12.

Unchanged: Go, Postgres, Redis, Temporal, ClickHouse, Clerk exchanged for our own cookie, Vite and React, guests allowed, 50-member cap, blue-violet palette.

## 1. Shape of the phase

| # | Feature | Why | One-line design |
|---|---|---|---|
| 1 | Crews + capture | Gives the group a stable home | A crew is a 1:1 layer on a permanent `rooms` row; same `/r/{slug}` link |
| 2 | Voice | Friends talk while they watch | Self-hosted LiveKit, tokens hand-signed in Go, lazy chunk |
| 3 | Presence and notifications | Brings people back | Web push; Temporal owns timing, `s2g notifier` owns delivery |
| 4 | Session recaps | Gives the evening an artifact | Postgres, built when a session ends, no API data in the stored document |
| 5 | Catch-up (time-shifted reactions) | The one feature competitors lack | Replay the crew's reactions at the same video position |
| 6 | More sources | Wider content | Direct HLS, Vimeo, Twitch VOD, Twitch live; Dailymotion deferred |

**Two changes to the requested order, both for cause:**

1. **Capture ships with crews, not with recaps.** Sessions and moments cannot be reconstructed afterwards. Every crew evening before capture exists is lost to recaps and catch-up, so capture is part of feature 1.
2. **Voice starts in parallel with crews.** It keys on `rooms.id` and has no crew dependency. Notifications do depend on crews, so they follow voice on the same track.

**New runtime pieces:** LiveKit (new container) and `s2g notifier` (new mode of the existing binary). `serve` stays free of any Temporal client.

**Superseded in `plan.md`:**

- §7 "signing in makes rooms permanent": this was never built, because `LinkClerkUser` only moves `owner_id` **[V]**. Permanence now comes only from "Keep this room".
- §9 "reactions never stored": still true for ephemeral rooms, no longer true for crew rooms.
- `POST /webhooks/clerk`: listed in the plan, does not exist **[V]**, and is not needed because `DELETE /v1/me` covers deletion.
- "No per-room workflows": still holds. The new workflows are short and per notification, with no signals and nothing on the playback path.

## 2. Data rules for stored third-party data

These apply to every feature below. Source: YouTube API Developer Policies and Required Minimum Functionality, the latter updated 2026-11-01 **[V]**.

| Rule | How we comply |
|---|---|
| Non-authorized API data is refreshed or deleted within 30 days | Long-lived tables store only `(source, source_id)`. Title, thumbnail and author come from a `LEFT JOIN media` where `fetched_at > now() - interval '30 days'`. Anything missing renders "Video unavailable". |
| No derived data or metrics from API data; no aggregation | Durations come from our wall clock, never `duration_ms`. No percent-watched. No trending across crews. |
| Our metrics next to API data need clear, prominent disclosure | Recap and history show: "Reactions and watch stats come from Stream2Gather, not YouTube." |
| No charging, gating or rewards for viewing | No streaks, badges, leaderboards or perks anywhere. Notification copy is an invitation. Membership gates a private room, not YouTube itself. Login is allowed when it is normal functionality **[V]**; see section 11 for `guest_access=false`. |
| Unmodified player, nothing in front of it, no ad blocking | Reaction rail and voice controls sit outside the player. `web/scripts/player-overlap.mjs` gains the catch-up route. |
| No background playback | Voice may continue when the tab is hidden, but we never keep a hidden YouTube player running. |
| Search results are not intermixed | The watchlist appears in the omnibox as its own labelled group, never merged into results. |
| Delete user data within 7 days of request | `DELETE /v1/me` deletes immediately. |
| No server-rendered image containing a thumbnail or title | Share cards are HTML. `og:image` is the live `media.thumbnail_url` resolved per request, as `roomPage` already does, with a generic image as fallback. |

**Existing gaps to close in Track A's first PR, because permanent rooms make them worse [V]:**

1. `CloseExpiredRooms` leaves `snapshot` in place forever, so closed rooms keep titles. Set `snapshot = NULL` at close and backfill once.
2. Permanent rooms keep titles in `rooms.snapshot` and in Redis past 30 days. Two fixes:
   - A `RefreshSnapshots` activity rewrites snapshots from `media` where `snapshot_checked_at < now() - interval '20 days'`, skipping rooms with people present.
   - A new system command `media.refresh` (same pattern as `CmdRelease`) runs on the first join of a `liveRoom` in a crew room. It updates items from `media` and drops items whose row is gone.
3. `search_cache` rows are never purged. Add the purge to the hourly maintenance run.
4. `RefreshStale` caps at 500 rows an hour, about 300k rows per 25 days. Add a `media_stale_backlog` metric, and alert when the backlog is above zero. Today nothing tells us when we fall behind.
5. When a video leaves `media`, `PurgeMediaRefs(source, id)` deletes watchlist rows and moments and nulls `session_items.source_id`. This treats video IDs as API data, the strict reading **[U]**.

## 3. Crews and capture

**Decision.** A crew is one `crews` row pointing at one `rooms` row with `is_temporary=false, expires_at=NULL`. The room is still the live thing. The hub, reducer, sync and `/r/{slug}` do not change. `SaveSnapshot` already writes `expires_at = NULL` for permanent rooms **[V]**.

**Old rooms keep working.** A room with no `crews` row behaves as it does today: 24-hour expiry, no capture, 410 when closed. All migrations are additive and there is no backfill. New JSON fields use `omitempty`, so old and new clients tolerate a rolling deploy.

### User flow

- **Create, first 10 seconds.** A signed-in user clicks "Start a crew" on the landing page, types a name, and lands on the crew home with the invite link already selected and a Copy button. Guests get the Clerk sign-in first.
- **Promote.** In any ephemeral room the host sees "Keep this room" in the room header menu. It is never a toast and never over the player. One click signs in if needed (`LinkClerkUser` moves the owner), then `POST /v1/rooms/{slug}/crew`. Everyone stays connected, the link does not change, and others see "This room is now a crew. Join to keep it."
- **Invite, first 10 seconds.** A friend opens `/r/{slug}?join={token}` and sees the crew name, member count, who is here, and two buttons: "Join the crew" (Clerk) and "Continue as guest". Joining strips the token with `replaceState`. A guest gets today's flow plus one line: "This crew keeps chat and reactions for its members."
- **Return.** `/r/{slug}` shows members the crew home (lazy `CrewHome`) rather than the join gate, with a primary "Join the room (3 here)" button. The click is also the autoplay gesture. The landing page shows a `CrewRail` for signed-in users only.
- **Crew home** contains: who is here now, what is playing, watchlist, last sessions with recaps, and "You missed this. Catch up." cards.

**Empty states:**

| Where | Copy |
|---|---|
| Sole member | "It's just you. Copy the invite." |
| Empty watchlist | "Add something for next time." with an omnibox |
| No sessions | "Your first watch party will show up here." |
| No crews | Rail is hidden |

**Rules:**

- Roster cap is 50, and a user may own 10 crews. The room's 50 concurrent cap is unchanged, so guests can fill a crew room; see section 11.
- Guests can watch, chat, react and control playback as they can today. They can't see history or edit the watchlist.
- `guest_access=false` makes the room members only, returning 403 `members_only` from `ticket`.
- The owner is `rooms.owner_id`, with no separate role column. Removing a member also rotates the invite token.
- `GET /v1/rooms/{slug}/messages` today serves all chat to any session **[V]**. In crew rooms non-members get only messages since the open session started. Ephemeral rooms are unchanged.

**Session rule.**

- A session opens at the first `playing` state in a crew room.
- It ends when nobody has been present for 5 minutes, or there has been no playback or chat for 30 minutes.
- One Temporal schedule sweeps every minute, which also covers crashed nodes. `crew_sessions` has at most one open row per crew.

### Data model

Migrations are `*_crews.sql` and `*_capture.sql`. See section 9 for numbering.

```sql
ALTER TABLE rooms ADD COLUMN snapshot_checked_at timestamptz;

CREATE TABLE crews (
  id text PRIMARY KEY,
  room_id text NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  invite_token text NOT NULL UNIQUE,              -- 128-bit, rotatable
  guest_access boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE crew_members (
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  notify text NOT NULL DEFAULT 'all' CHECK (notify IN ('all','off')),
  PRIMARY KEY (crew_id, user_id));
CREATE INDEX ON crew_members (user_id);

CREATE TABLE watchlist_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  source text NOT NULL, source_id text NOT NULL,
  added_by text REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  watched_session_id text, removed_at timestamptz);
CREATE UNIQUE INDEX ON watchlist_items (crew_id, source, source_id) WHERE removed_at IS NULL;

CREATE TABLE crew_sessions (
  id text PRIMARY KEY,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  started_by text REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz);
CREATE UNIQUE INDEX ON crew_sessions (crew_id) WHERE ended_at IS NULL;

CREATE TABLE session_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
  source text NOT NULL, source_id text,            -- nulled by PurgeMediaRefs
  started_at timestamptz NOT NULL, ended_at timestamptz);

CREATE TABLE session_people (
  session_id text NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  display_name text NOT NULL, is_guest boolean NOT NULL,
  joined_at timestamptz NOT NULL, left_at timestamptz,
  PRIMARY KEY (session_id, user_id));

CREATE TABLE moments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  session_id text REFERENCES crew_sessions(id) ON DELETE CASCADE,
  source text NOT NULL, source_id text NOT NULL,
  pos_ms bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reaction','chat')),
  origin text NOT NULL DEFAULT 'live' CHECK (origin IN ('live','catchup')),
  user_id text, author_name text NOT NULL,
  emoji text, message_id bigint REFERENCES messages(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON moments (crew_id, source, source_id, pos_ms);

CREATE TABLE outbox (                              -- written by A, drained by B
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('session.started','recap.ready')),
  ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz);
CREATE INDEX ON outbox (id) WHERE done_at IS NULL;
```

`messages` does not change. A chat moment points at its message, so the hot table gets no new columns.

### API and WebSocket

| Route | Who | Purpose |
|---|---|---|
| `POST /v1/crews {name}` | account | Create a room and crew in one transaction; 409 `crew_limit` over 10 |
| `POST /v1/rooms/{slug}/crew` | signed-in room owner | Promote in place; 410 if closed |
| `GET /v1/crews/{slug}` | member | Crew home document |
| `PATCH /v1/crews/{slug} {name?, guestAccess?, ownerId?}` | owner | Settings and transfer |
| `DELETE /v1/crews/{slug}` | owner | Close the room and cascade |
| `POST /v1/crews/{slug}/join {token}` | account | 403 `invalid_invite`, 409 `crew_full` |
| `DELETE /v1/crews/{slug}/members/{userId}` | self or owner | Leave or remove |
| `POST /v1/crews/{slug}/invite` | owner | Rotate the token |
| `PATCH /v1/crews/{slug}/me {notify}` | member | Notification preference |
| `GET /v1/me/crews` | account | Rail with live counts from `Live.People`, polled every 30s while visible |
| `GET, POST, DELETE /v1/crews/{slug}/watchlist[/{id}]` | member | POST `{url}` or `{source, sourceId}`, resolved through the catalog |
| `GET /v1/crews/{slug}/sessions?before=` | member | Keyset history, metadata joined fresh |
| `DELETE /v1/me` | account | Deletion, see below |

- `GET /v1/rooms/{slug}` gains `crew: {memberCount, isMember, guestAccess}`.
- `Person` gains `member`.
- `DELETE /v1/me`: passes ownership to the earliest member, or closes a crew with no other members. Removes the user's moments and messages, and rewrites `session_people` to "Former member".
- **WebSocket:** one new server event, `{type:"crew", changed:"settings"|"members"|"watchlist"}`, published by the API through `Live.Publish`. `deliver` already forwards unknown types **[V]**, and the client refetches REST. There are no new client messages.
- Playing from the watchlist uses the existing `queue.add`.

### Service boundaries

- **`serve`** owns crew REST, in new `api/crews.go` and `store/crews.go`.
- **`hub/record.go`** implements a `Recorder`:

  ```go
  type Recorder interface {
      Applied(roomID string, s room.State)              // from mutate, covers system commands
      Joined(roomID string, p store.Person)
      Left(roomID, userID string)
      Moment(roomID string, m Moment)                   // from chat and react
  }
  ```

  All four are non-blocking sends to a bounded channel (4096). One goroutine per node looks up crew by room (cached 30s, negative results included, so promotion needs no ticket change), reads `Live` state once per room per flush, computes `pos_ms` with `State.PositionAt(at)`, and batch-writes every second. A session opens with `INSERT ... ON CONFLICT DO NOTHING` plus an outbox row in one transaction, which also issues `NOTIFY outbox`.

  A watchlist item is ticked after 30 seconds of unbroken play by our clock, with a member seated for those 30 seconds (`store.WatchedAfter`). Pausing or seeking restarts the count, and a video's own length is never used. A clip under 30 seconds stays on the list. This is a threshold, not schema, so changing it needs no migration and touches no stored rows.
- **`room.Apply`** is unchanged apart from `media.refresh`.
- **`s2g worker`** gains the `SweepSessions` schedule. It ends sessions and builds recaps inline (section 6), so Track A never depends on the notifier.

### Failure behavior

| Failure | Behavior |
|---|---|
| Recorder channel full or Postgres down | Drop the event, increment `recorder_dropped_total`; playback and chat are unaffected |
| Node crash | Sweeper ends the session; open `session_people` rows close at `ended_at` |
| Promote races room expiry | One `UPDATE ... WHERE closed_at IS NULL`; loser gets 410 |
| Join with a rotated token | "This invite link has expired. Ask for a new one." with a guest option if allowed |
| Crew over 50 | 409 `crew_full`; guest entry is still possible |
| Redis state gone after 7 idle days | `ensureState` restores from the snapshot **[V]** |
| Temporal down | Sessions stay open until it returns, then are swept; `ended_at` uses `last_activity_at` |

### Tests

- **Go integration:** create, promote, join, remove, rotate, transfer, delete. Crew and session limit races. One open session under concurrent first plays. Ephemeral room writes zero rows to capture tables. `messages` scoping. Migration applied to a database holding live ephemeral rooms. `PurgeMediaRefs`. `RefreshSnapshots`. `media.refresh`. `DELETE /v1/me`.
- **Recorder:** full channel never blocks; dropped events are counted.
- **Vitest:** `CrewHome` states, `crew` event handling.
- **e2e:** invite link flow in two contexts, guest and member in one room, promote without any socket drop. An `e2e/mint-account` helper signs an account cookie with the test key, so no test-only server route exists.

### Exit

- Create to invite copied takes under 10 seconds in the scripted flow.
- A promoted room keeps its URL and all connections.
- Existing `make e2e` passes unchanged.
- At 50 simulated clients at the reaction limit, `recorder_dropped_total` is 0, and command p95 is within 5% of the pre-change run in `perf/`.
- Entry JS stays at or below 79.4 kB gz, enforced by `web/scripts/bundle-budget.mjs`.
- `crew_second_session_14d` is reported in ClickHouse telemetry. This is the phase's headline metric. It has no target until real usage exists.

## 4. Voice

**Decision: self-hosted LiveKit.** It is Apache-2.0, works at the 50-person cap, and needs no vendor key. Peer-to-peer is rejected: a mesh does not scale to 50, and without an SFU we would still need TURN. LiveKit Cloud stays available as an escape hatch through the same `LIVEKIT_URL`.

**Versions and sizes [V]:**

| Item | Value |
|---|---|
| Server | `livekit/livekit-server:v1.13.11`, 2026-10-25, 41 MB compressed amd64, 125 MB local |
| JS | `livekit-client` 2.23.0: **149.5 kB gz**, 124.6 kB brotli, measured with esbuild for the APIs we use |
| Components | `@livekit/components-react` is not needed |
| Go | `server-sdk-go/v2` v2.19.0 and `protocol` v1.53.2: importing only `protocol/auth` takes `s2g` from 36.09 to 46.78 MB (+30%, pulls pion) |

**Do not add the Go SDK.** Sign the HS256 JWT with the standard library, about 40 lines, and call Twirp over plain JSON HTTP.

**Local spike, 2026-11-05 [V]:** two headless Chrome pages with a fake mic, against the real server in Docker on ports 17880-17882.

- A hand-signed token was accepted. `RoomService/ListRooms` returned 200 with a hand-signed admin token.
- Audio flowed on the UDP mux port: selected pair `udp 17882`, listener received 59 kB in 6 seconds.
- Listen-only join needed no mic.
- `ActiveSpeakersChanged` fired.
- A second tab with the same identity disconnected the first with `DUPLICATE_IDENTITY`.
- Join took 77-350 ms. This is loopback, so it says nothing about real networks.

`RemoveParticipant` over Twirp was not exercised **[U]**. If the hand-signed path ever drifts, the fallback is `protocol/auth`, at the binary cost above.

### User flow

- **First 10 seconds.** A "Join voice" button sits in the room header, or in a bar under the player on phones. Hovering preloads the chunk. Clicking fetches a token, connects listen-only, and calls `room.startAudio()` inside the gesture. There is no mic prompt. The user sees "You're listening" and a muted mic button. The first unmute triggers the browser prompt.
- **Empty states.** Alone: "You're the first one here. Others will see you in voice." When someone else is in voice: "Hana is in voice. Join".
- **Talking.** Default is toggle mute, with `M` as the shortcut. Push-to-talk is an option in voice settings: an on-page hold button, plus hold `V`. Key events do not reach us when focus is inside a cross-origin player iframe **[V]**, so the hold button is the reliable path and the UI says so. PTT releases on `blur`, `visibilitychange` and `pointercancel`. The track stays published and toggles mute, so PTT has no republish delay.
- **Ducking.** While a remote participant speaks (`ActiveSpeakersChanged`), the player volume drops to 30% in steps over about 150 ms and returns after a 600 ms hold. It uses documented `setVolume`, reads the user's level first, leaves a muted player alone, and does not fight manual changes. It is a user toggle. It is **off for YouTube by default until the owner decides** (section 12). It does nothing on iPhone, where JS can't change media volume **[V]**.
- **Phones and blocked mics.** `NotAllowedError`: stay listening and show how to re-enable the mic for this site. `NotFoundError`: "No microphone found. You can still listen." A headphones hint appears on first unmute.
- **Reload.** Voice never rejoins by itself, because audio needs a fresh gesture.

### Data model

No tables. Voice state is ephemeral: `Person` gains `voice` (`""|listening|muted|live`). `People` must prefer a non-empty value across tabs, because today the first tab wins **[V]**. No audio is ever recorded, and we do not run Egress.

### API and WebSocket

- `POST /v1/rooms/{slug}/voice-token` returns `{url, token, expiresAt}`. It requires a session and presence in `Live.People`, and 503 `voice_unavailable` when unconfigured. It is limited through the existing `Limit`.
- Token: `iss` key, `sub` user id, `name`, `nbf`, `exp` at 10 minutes. Grant: `roomJoin`, `room: s2g-{rooms.id}`, `canPublish`, `canPublishSources: ["microphone"]`, `canSubscribe`, no data channel.
- LiveKit refreshes tokens for connected participants every 5 minutes **[V docs]**; a long-session test confirms this.
- `GET /v1/config` gains `voice: bool`.
- Client to server: `{type:"voice", state:"listening"|"muted"|"live"|"off"}`. The hub sets `Person.Voice` and calls `publishMembers`. Speaking indicators stay client side, from LiveKit events.
- `PlayerAdapter` gains `setVolume(0..1)` and `volume(): number | null`.

### Service boundaries

- LiveKit is the only media path, and it knows nothing about crews.
- `serve` mints tokens and calls `RemoveParticipant` when a crew member is removed. Revocation is Cloud-only **[V]**, so removal is that call plus the short TTL.
- `web/src/voice/` is a lazy chunk that nothing on the entry path imports.
- CSP adds `connect-src` for the LiveKit origin. New header: `Permissions-Policy: microphone=(self)`.
- Audio is encrypted in transit, but the server can technically hear it. E2EE needs key distribution and is out of v1.

**Local.** Compose service `livekit`, loopback only: signal **17880**, ICE/TCP **17881**, ICE/UDP mux **17882**, `node_ip: 127.0.0.1` **[V by spike]**. `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (at least 32 characters) live in `server/.env.local` and are passed through `LIVEKIT_KEYS`, never in the compose file.

### Failure behavior

| Failure | Behavior |
|---|---|
| LiveKit down or unconfigured | Button reads "Voice unavailable"; the room is unaffected |
| Chunk load fails | Same message, retry on next click |
| Network drop | LiveKit reconnects; "Reconnecting voice"; after failure, back to "Join voice" |
| Second tab | Old tab: "Voice moved to another tab" (`DUPLICATE_IDENTITY`) |
| UDP blocked | Falls back to ICE/TCP 17881; without TURN/TLS some strict networks fail, shown as "Voice can't connect on this network" |
| Audio autoplay refused | `AudioPlaybackStatusChanged` shows "Tap to hear voice" |

### Tests

- **Go:** token claims and TTL against a golden JWT; presence requirement; 503 path. Integration against compose LiveKit: token accepted, `RemoveParticipant` works.
- **Vitest:** ducking state machine with fake timers (attack, hold, user override, muted), PTT release on all three events.
- **e2e:** Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`: two users hear each other (`bytesReceived` rising), mic denied stays listening, LiveKit stopped leaves playback green, 15-minute soak past token expiry.
- **`player-overlap.mjs`:** passes at all 6 layouts with voice open.
- **Real devices, once:** iPhone Safari, Android Chrome, Mac Safari, Chrome with AirPods.

### Exit

- Click to listening: p95 under 1.5 seconds across two real networks.
- Unmute to audible: under 500 ms.
- Playback sync p95 unchanged from `measurements.md` with 6 people talking.
- Entry JS unchanged; `RoomPage` chunk grows by at most 3 kB gz; voice chunk at most 155 kB gz.
- With LiveKit stopped, `make e2e` passes.
- The real-device matrix is recorded in `measurements.md`.

## 5. Presence and notifications

**Decision.** Web push first. It needs no provider key: only VAPID keys we generate, and no Apple Developer account **[V]**. Email stays behind a `Channel` interface with no implementation until there is a provider key.

**Who does what:**

- **Temporal** owns timing, dedupe and retries. It answers "should this person hear about this, and when".
- **`s2g notifier`** owns delivery. It is the only holder of the VAPID private key, pumps the outbox, runs the `notify` task queue, sends pushes and prunes dead subscriptions.
- **`serve`** only reads the public key and writes subscription rows. It never touches Temporal.

**Presence means crew presence:** who is in the room, in voice and what is playing, from `Live.People` and room state, shown on the crew home and rail. There is no app-wide "online" indicator, which would need a socket on every page and first-load JS.

### User flow

- **First 10 seconds.** Never on page load. A crew home card reads "Get a ping when your crew starts watching." with an "Allow" button. The click requests permission and subscribes in the same handler, as Safari requires **[V]**. It then shows "You're on. We'll ping this device."
- **iPhone.** Web push works only from a Home Screen web app, iOS 16.4 or later **[V]**. In a Safari tab the card reads "Add Stream2Gather to your Home Screen to get pings", with the steps.
- **Receive.** "Hana started watching in Movie Night" / "Join in". Tapping opens or focuses `/r/{slug}`. The video title is left out, which avoids spoilers and sending API data to push services.
- **Settings.** Per crew on or off (`crew_members.notify`), plus a device list in account settings. Empty state: "No devices yet."
- **Denied.** "Notifications are blocked for this site" with browser instructions; we never ask again.

### Data model

Migration `*_push.sql`:

```sql
CREATE TABLE push_subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL,
  user_agent text, created_at timestamptz NOT NULL DEFAULT now(), last_ok_at timestamptz);
CREATE INDEX ON push_subscriptions (user_id);

CREATE TABLE notification_log (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  kind text NOT NULL, ref text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref));
CREATE INDEX ON notification_log (user_id, crew_id, sent_at DESC);
```

### API and WebSocket

- `GET /v1/config` gains `vapidPublicKey`.
- `POST /v1/push/subscriptions {endpoint, keys, claim}` requires an account. Without `claim` it only refreshes a browser this person holds and otherwise answers `409 not_yours`. With `claim`, sent only by pressing Allow, it upserts by endpoint and can take the browser from its holder.
- `DELETE /v1/push/subscriptions/{id}`.
- `GET /v1/me/notifications` returns devices and per-crew settings.
- No WebSocket changes.
- Push payload, under 4 KB and in Declarative Web Push format **[V]**, which older browsers handle in `sw.js`:

  ```json
  {"web_push":8030,"notification":{"title":"...","body":"...","navigate":"/r/slug"}}
  ```

- Headers: `TTL: 300`, `Topic: crew id` (within the 32-character limit, hashed), `Urgency: high`.
- Every push shows a visible notification, because silent pushes get permission revoked **[V]**.
- `web/public` gains `manifest.webmanifest`, `sw.js` and icons. The service worker registers only after the user opts in, so first load does not change. `static.go` serves `sw.js` with `Cache-Control: no-cache`. CSP gains `worker-src 'self'`.

### Service boundaries and flow

```
hub recorder ──tx──► crew_sessions + outbox ──NOTIFY──┐
worker sweeper ─tx─► session_recaps + outbox ─────────┤
                                                      ▼
                    s2g notifier: pump (LISTEN + 30s poll)
                        ExecuteWorkflow id=notify-{kind}-{ref}, queue=notify
                                                      ▼
                    NotifySession: sleep 30-45s
                        session still open? else stop
                        audience = members, notify=all, not present, not the starter,
                                   not notified for this crew in the last 30 min
                        activity: send, log, prune on 404/410, honor Retry-After on 429
```

The durable timer stops a false start from pinging anyone. The workflow ID dedupes. `NotifyRecap` has the same shape without the timer, and goes only to members in `session_people` with at least 2 people present.

### Failure behavior

| Failure | Behavior |
|---|---|
| Notifier or Temporal down | Outbox grows, product unaffected. `session.started` rows older than 5 minutes are marked done unsent. `recap.ready` rows are kept 24 hours |
| Notifier restarts mid-timer | Temporal resumes the workflow; no double send |
| Push service 404/410 | Delete the subscription |
| 429 or 5xx | Activity retry with backoff, up to the 300s TTL |
| Session ends before the timer | Nothing sent |
| Duplicate activity retry | `notification_log` primary key prevents a second send |

### Tests

- **Go:** Temporal test environment drives `NotifySession` through the timer: session ended, cap hit, present user skipped, starter skipped.
- **Delivery:** fake push endpoint in `httptest`, checking 410 pruning, 429 retry, headers, and VAPID JWT reuse (Apple asks for at most one refresh an hour **[V]**).
- **Pump:** crash between start and mark-done sends once.
- **Static:** `sw.js` caching header.
- **e2e:** Chrome subscribes against the fake endpoint; `notificationclick` routing with a stubbed payload.
- **Real devices, once:** iPhone Home Screen, Android Chrome, Mac Safari.

### Exit

- Absent members get the push within 60 seconds of session start at p95, in the fake-endpoint run.
- Killing the notifier during the timer gives exactly one notification.
- `serve` passes `make e2e` with Temporal and the notifier both stopped.
- First-load JS is unchanged.
- The real-device pass is recorded.

## 6. Session recaps

**Decision: Postgres.** A recap is a product read and must not be lossy, and a session is a few hundred rows. ClickHouse here is a best-effort telemetry sink with a 30-day TTL, and `plan.md` keeps it out of product reads **[V]**. Funnels may still go to ClickHouse.

### User flow

- **First 10 seconds.** A member opens the crew home after a session, or taps "Your recap from Movie Night is ready". The card at the top shows: who came, time together, videos in order, total reactions, and the biggest moment with its emoji counts and a "Relive it" link.
- **Biggest moment.** The densest 20-second window of moments, needing at least 3 events from at least 2 people. Ties go to the earliest.
- **Empty states.** A session without a qualifying moment gets a quiet card: "A quiet one. 2 videos, 1 h 10 min together." A solo session is listed but sends no notification. A video gone from `media` reads "Video unavailable".
- **Share.** Off by default. "Share this recap" creates a revocable link, `/s/{token}`. The public page shows names, videos, reaction counts and the biggest moment, never chat text. It has a link to the video on its source site, no embed, and a "Start your own room" button. Turning sharing off gives a 404.
- **Ephemeral rooms** get no recap. The host sees "Keep this room" instead.

### Data model

Migration `*_recaps.sql`:

```sql
CREATE TABLE session_recaps (
  session_id text PRIMARY KEY REFERENCES crew_sessions(id) ON DELETE CASCADE,
  doc jsonb NOT NULL,                 -- no title, thumbnail, author or duration from any source
  share_token text UNIQUE,            -- NULL when not shared
  built_at timestamptz NOT NULL DEFAULT now());
```

`doc`: `{wallMs, people:[{name,isGuest}], items:[{source,sourceId,reactions,messages}], reactions:{emoji:n}, biggest:{source,sourceId,posMs,emojis,people}|null}`. Titles and thumbnails are joined at read time (section 2).

### API and WebSocket

- `GET /v1/crews/{slug}/sessions/{id}/recap` (member).
- `POST /v1/crews/{slug}/sessions/{id}/recap/share {public}` (any member who attended) returns `{url}`, or removes the token.
- `GET /v1/recaps/{token}` (public).
- `GET /s/{token}` serves the SPA with OG tags and `X-Robots-Tag: noindex`, in the style of `roomPage`.
- No WebSocket changes.

### Service boundaries

`SweepSessions` ends a session and runs `BuildRecap` as an idempotent activity in `s2g worker` (`INSERT ... ON CONFLICT DO UPDATE`). It writes the `recap.ready` outbox row in the same transaction. `serve` only reads.

### Failure behavior

| Failure | Behavior |
|---|---|
| Build fails | Temporal retries; card reads "Your recap is on its way." |
| Recorder dropped events | Recap is built from what exists; the biggest moment may be smaller |
| Member deleted | Name becomes "Former member" in new reads; `doc` is rewritten by `DELETE /v1/me` |
| Video purged | "Video unavailable"; `biggest` link is removed |

### Tests

- **Go:** pure `recap.Build` table tests for window edges, the 2-person rule, ties, quiet sessions, no items. Rebuild is idempotent.
- **Compliance test:** seed `media` with marker strings and assert none appear in `doc`.
- **Read path:** stale `media` gives "Video unavailable". Share on, off and revoked. Disclosure line is present.
- **Public JSON:** contains no chat text.
- **e2e:** two users, reactions, forced sweep, recap renders, share link opens signed out.

### Exit

- Recap is readable within 2 minutes of session end.
- The compliance test passes on every CI run.
- A 4-person, 2-hour simulated session builds in under 1 second.
- A shared link renders for a signed-out visitor, and stops within one request of revocation.

## 7. Catch-up: time-shifted reactions

**Competitors, plainly.** We found no evidence that Teleparty, Watch2Gether, Kosmi or Rave offers replay of a group's reactions at the same video position. That is based on public product pages and FAQs only, with no hands-on testing, and absence from a page is not proof **[U]**. All four are built around live sync. AniDachi, a Crunchyroll extension, says "Async catch-up with replayed reactions is planned, not available today", so the idea isn't unique and the window may be short. Danmaku on Bilibili and Niconico is the same mechanic for public audiences, from memory **[U]**. Friend-scoped replay is what we would own.

Everything else in this phase is catch-up with the market: W2G has saved rooms with activity notifications, Kosmi has private rooms and voice, Rave has voice, and Teleparty sells voice in Premium.

Long-distance couples are the core case: one of them missed the session, or lives eight hours away.

### User flow

- **First 10 seconds.** A member who was absent sees "You missed this. Catch up." on the crew home, or follows the recap's "Relive it". The page loads at `/r/{slug}/catchup/{sessionItemId}` with the player, the rail beside it (below it on phones), and a density strip under the player. Clicking Play is the gesture. Reactions appear in the rail as the video reaches each position, with the author: "Hana, 12:04, [emoji]".
- **Reacting.** The same six reactions plus chat. The new moments are stored with `origin='catchup'`, so a partner sees them next time. "Relive it" starts at the moment minus 10 seconds, through `seek`.
- **Empty state.** "Nobody reacted to this one yet. Your reactions will be here for the next person."
- **Spoilers.** In the room, chat from sessions a member missed is collapsed behind a Catch up button. The crew home never shows chat.
- **Embed blocked (Error 150, about a third of videos in our sample [V]).** Show the text timeline with timestamps and "Open on YouTube".
- **Rules.** Members only. No WebSocket and no room join. Nothing overlays the player. No autoplay. Twitch live and purged videos have no catch-up.

### Data model

No new tables. Reads use `moments` and `session_items`. The existing index covers the query.

### API and WebSocket

- `GET /v1/crews/{slug}/moments?source=&id=&from=&to=` returns moments for the video across the crew's sessions, with chat bodies joined, in keyset pages of 500.
- `POST /v1/crews/{slug}/moments {source, id, posMs, emoji?|body?}` validates the emoji against the allowlist and is rate limited like `react`.
- No WebSocket changes.

### Service boundaries

`web/src/catchup/` is a lazy route using the existing `PlayerAdapter` alone, with no `RoomSession` and no sync controller. `main.tsx`'s path regex currently captures subpaths as a room slug **[V]**, so T0 changes it. `static.go`'s SPA fallback already serves the path **[V]**.

**Firing rule.** Poll `adapter.time()` at 4 Hz and fire moments crossed during normal play within 0.25 seconds. A jump of more than 2 seconds resets the cursor without firing, so seeking never bursts.

### Failure behavior

| Failure | Behavior |
|---|---|
| Adapter errors | Text timeline |
| Moments fetch fails | The video still plays; rail reads "Couldn't load reactions. Retry" |
| Post fails | Retry once, then an inline note; playback is unaffected |
| Ads | `time()` should hold during ads, so moments fire after them **[U]**; test with a real ad |
| Video gone | Route shows "Video unavailable" and the crew link |

### Tests

- **Vitest:** firing rule with a fake adapter: normal play, seek forward and back, pause, rate 2x, jump reset.
- **Go:** membership, allowlist, rate limit, pagination.
- **e2e:** record reactions in a live session on the html5 fixture, open catch-up as a second user, assert each fires at the right position and that no WebSocket opened.
- **`player-overlap.mjs`:** runs on this route.

### Exit

- On the html5 fixture and on YouTube, reactions fire within 500 ms of their stored position.
- Seeking produces no burst.
- Notification to first reaction takes at most 2 clicks.
- `moments_catchup_per_session` is reported.

## 8. More sources

All use the existing contract: Go `Source` (`Match`, `Resolve`, optional `Search` and `Trending`) and web `PlayerAdapter` **[V]**. A new source adds two files and a switch line.

| | Direct HLS | Vimeo | Twitch VOD | Twitch live | Dailymotion |
|---|---|---|---|---|---|
| **Order** | 1 | 2 | 3 | 4 | Deferred |
| **Embed terms [V]** | Our player; host must allow CORS | Developer Addendum: no obscuring, no ads in player, public privacy policy, no fee without authorization | SSL, `parent` domain, min 400x300, not obscured, can't charge specifically for watching | Same | FAQ (2026-10-22): embedding and custom Player only on the paid Edge plan |
| **Metadata** | None | oEmbed, no key | None in v1 (see below) | None | Authenticated API |
| **Storage limit** | None | Normal `media` | Agreement allows only a 24-hour cache, so we store none | Same | Unknown |
| **Rates** | `fine` (best sync) | `fine`, plan-gated **[U]** | `none`: no `setPlaybackRate` **[V]** | Not applicable | `discrete`, 0.25-2 steps **[V]** |
| **Time** | Sync | Async, so cache from `timeupdate` (about 250 ms) and interpolate | Sync `getCurrentTime` | No shared position | `getState()` async **[V]** |
| **Sync limit** | As html5 today | Near html5 if rate works, else seek-only | Seek only; drift target 1.5 s **[U]** | Same channel; each person sees their own live edge | Not assessed |
| **Volume (ducking)** | Yes | `setVolume` | `setVolume` | `setVolume` | `setVolume` |
| **Needs from owner** | Abuse stance | Eligible Vimeo account **[U]**, privacy policy | Production domain, phone decision | Same | Pay for Edge or drop |

**Key choices:**

- **Direct HLS is already built** (`direct.go`, `html5.ts`, lazy hls.js 185 kB gz) and sits behind `ALLOW_DIRECT_MEDIA` **[V]**. The remaining work is abuse stance, a clear CORS error and tests. VOD only; live HLS is **[U]**. We never proxy media.
- **Twitch v1 is URL-only.** `Resolve` parses `twitch.tv/videos/{id}` and `twitch.tv/{channel}` and stores `Title: "Twitch video"` or the channel from the URL, with no thumbnail and no Helix call. The embed needs no client ID **[V]**. That removes the credentials dependency and the 24-hour storage problem, including inside `rooms.snapshot`, for the price of a plainer queue row. If titles are wanted later, add Helix with a per-source `MaxAge` of 20 hours and apply it to snapshots too.
- **Twitch minimum width.** 400 px does not fit a 390 px phone **[V]**. Below the minimum, show "Rotate your phone or open on Twitch". Never shrink the embed.
- **Twitch in history.** Generic "Twitch video" plus a link.
- **Clips** have no JS control **[V]** and are refused at `Match`.
- **Dailymotion deferred.** Its SDK could work, but the docs point to a paid plan **[V]** and a non-commercial clause needing review. Whether to pay is the owner's call.

### Flow, data, API, boundaries

- **User flow.** Paste a link in the omnibox and it queues in under a second. Sources without search show nothing in search; the omnibox placeholder reads "Search YouTube or paste a Vimeo, Twitch or .m3u8 link". Unsupported URL: "That link isn't supported yet." The source name shows on queue rows.
- **Live items.** Hide seek and rate controls through `rules.ts`, and show "Live: everyone's on the same channel". Skip moments and catch-up. A join loads the channel at its live edge.
- **Data.** No migration. Vimeo uses `media`. `source_id` holds `id` or `id:hash` for unlisted Vimeo videos.
- **API and WebSocket.** No new routes or messages. `/v1/config` lists enabled sources.
- **Contract changes.** `rates` gains `'none'`, and `controller.ts` corrects by seek only with a wider threshold. Optional `Source.MaxAge()`, unused in v1.
- **CSP.** Vimeo `player.vimeo.com`, `i.vimeocdn.com`. Twitch `player.twitch.tv`. Enabled only when the source is on.
- **Boundaries.** `@vimeo/player` and the Twitch script load lazily per source. `parent` comes from config: `localhost` in dev (127.0.0.1 is **[U]**).

### Failure behavior

| Failure | Behavior |
|---|---|
| Vimeo oEmbed 403/404 or `domain_status_code: 403` | Refused at `Resolve`: "This video can't be embedded here." |
| Twitch sub-only or deleted VOD | Known only at play; adapter `onError` uses the existing `mediaError` path and skips, as for YouTube |
| HLS CORS failure | "This stream doesn't allow playback here." |
| Twitch pre-roll ad | Existing held state if detectable; otherwise a viewer lags then seek-corrects **[U]** |
| Twitch or Vimeo script blocked | Same error path; other sources unaffected |

### Tests

- **Shared adapter conformance suite** in `web/src/players/conformance.test.ts`, against fakes of each SDK: play, pause, seek, `time()` sync and monotonic, `setVolume`, `rates` honored, `destroy`.
- **Go:** table tests for `Match` and `Resolve` with recorded fixtures.
- **`controller.test.ts`:** `rates:'none'` path.
- **e2e:** a local HLS fixture in two contexts.
- **Measured once by hand, in `measurements.md`:** Vimeo and Twitch drift between two browsers.

### Exit

- Each shipped source passes conformance, and queue-to-synced-playback works in two browsers.
- p95 drift: Direct HLS equal to html5 today; Vimeo at or below 500 ms; Twitch VOD at or below 1.5 s. These are targets to confirm.
- No source adds bytes to entry JS or the `RoomPage` chunk.
- No Twitch metadata beyond the URL appears in Postgres or Redis.

## 9. Tracks

**Wait.** `api.go`, `hub.go`, `serve.go`, `live.go`, `postgres.go`, `RoomPage.tsx`, `session.ts`, `useRoomPlayer.ts`, `sync/*` and others are being edited now, and `00002_session_version.sql` is untracked. T0 starts after that work lands.

**T0: shared seams, one small PR, one engineer, about half a day.** Every shared file is touched here, so the tracks do not collide.

| File | Change |
|---|---|
| `server/internal/api/api.go` | `Handler()` calls `s.crewRoutes(mux)`, `s.voiceRoutes(mux)`, `s.pushRoutes(mux)`; `contentPolicy` takes a struct; `Permissions-Policy`; `/v1/config` features |
| `server/internal/hub/{hub,serve}.go` | `Recorder` interface with a no-op default, calls from `mutate`, `join`, `leave`, `chat`, `react`; `voice` case calling `r.voice` |
| `server/internal/store/live.go` | `Person.Member`, `Person.Voice`, `People` merge |
| `server/internal/config/config.go` | LiveKit, VAPID, source fields |
| `server/cmd/s2g/main.go` | `notifier` mode dispatch to `notifier.go` |
| `server/internal/workflows/workflows.go` | Registration hooks for both tracks |
| `web/src/main.tsx` | Route switch for `/r/{slug}`, `/r/{slug}/catchup/{id}`, `/s/{token}` |
| `web/src/routes/{RoomPage,Landing}.tsx`, `web/src/ui/RoomHeader.tsx` | Lazy slots: `CrewHome`, `CrewRail`, `VoiceButton` |
| `web/src/room/session.ts` | `crew` event callback |
| `web/src/ui/{Omnibox,PeoplePanel,QueuePanel}.tsx` | Omnibox extra-group prop and placeholder from `/v1/config`; `member` and `voice` badges; source name on queue rows |
| `web/src/players/types.ts`, `{youtube,html5}.ts`, `web/src/ui/useRoomPlayer.ts` | `setVolume`, `volume`, `rates:'none'`, `createPlayer` registry |
| `web/scripts/bundle-budget.mjs` (new), `Makefile`, `deploy/compose.yaml` | CI budget check, `notifier` target, `livekit` service |

**Migration numbers.** `goose.Up` is called with defaults **[V]**, which should refuse out-of-order files **[U: confirm for the pinned version]**. So do not reserve numbers per track. Each PR takes the next free number at merge. Nothing else references the numbers. Next free today: 00003.

**Track A: Crews and memory.** Order: A1 crews + section 2 fixes, A2 capture, A3 recaps, A4 catch-up.

| Owns | |
|---|---|
| Server | `server/internal/store/{crews,sessions,recaps}.go`, `server/internal/api/crews.go`, `server/internal/hub/record.go`, `server/internal/recap/`, `server/internal/workflows/sessions.go`, `server/internal/store/postgres.go` compliance changes, `room/apply.go` `media.refresh`, migrations `*_crews`, `*_capture`, `*_recaps` |
| Web | `web/src/routes/CrewHome.tsx`, `web/src/crew/*`, `web/src/recap/*`, `web/src/catchup/*`, `web/src/ui/ChatPanel.tsx` (spoiler collapse), `web/scripts/player-overlap.mjs` |
| Tests | `e2e/crews.mjs`, `e2e/mint-account/` |

**Track B: Reach.** Order: B1 voice, B2 notifications, B3 sources.

| Owns | |
|---|---|
| Server | `server/internal/voice/`, `server/internal/api/voice.go`, `server/internal/hub/voice.go`, `server/internal/notify/`, `server/cmd/s2g/notifier.go`, `server/internal/api/push.go`, `server/internal/api/static.go`, `server/internal/source/{vimeo,twitch}.go`, `server/internal/source/direct.go`, migration `*_push` |
| Web | `web/src/voice/*`, `web/src/push/*`, `web/public/{sw.js,manifest.webmanifest,icons}`, `web/src/players/{vimeo,twitch}.ts`, `web/src/players/conformance.test.ts`, `web/src/sync/controller.ts` (`rates:'none'`), `web/src/ui/rules.ts` |
| Infra and tests | `deploy/livekit/*`, `e2e/voice.mjs`, `e2e/push.mjs` |

**Dependencies between tracks, all one-way:**

- B2 needs A1 and A2's tables (`crews`, `crew_sessions`, `outbox`). A1 and A2 land while B works on voice, so B should not block. If A slips, B swaps B2 and B3.
- A's crew-removal path calls `voice.Remove` from B1 through a small interface; the no-op default lets A merge first.
- Crew home's push card is a slot in A's page, filled by B's lazy `web/src/push/Card.tsx`.

**Overlap left after T0:** `web/src/crew/*` imports B's card through that one slot, and `DELETE /v1/me` (A) relies on FK cascade for B's tables. There is no shared file edit.

## 10. Coolify on a single VPS

Deployment itself is out of scope. Each new piece needs:

| Service | Needs |
|---|---|
| **LiveKit** | Image pinned to v1.13.11. Domain `lk.<domain>` through Traefik to the signal port, for `wss`. **Direct host ports** outside the proxy: TCP 7881 and UDP 7882 (UDP mux instead of a 10k range), opened in the VPS firewall. Coolify says direct mappings require **disabling rolling updates** for that application **[V]**. `rtc.use_external_ip` or `node_ip`. `LIVEKIT_KEYS` as a Coolify secret. No volume. Own Redis is not needed on one node; do not share ours. Host networking is LiveKit's "optimal" setup **[V]** and is an alternative. Sizing: start at 1 vCPU and 512 MB and measure **[U]**. |
| **TURN/TLS (optional)** | Needs 443, which Traefik holds **[V]**, a separate domain and cert, and a Traefik TCP SNI passthrough. v1 skips it; see section 12. |
| **`s2g notifier`** | Same image, command `s2g notifier`. No public port. Reaches Postgres and Temporal, plus outbound 443 to push services. Secrets `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`. Health on **18090**. One replica. |
| **`s2g serve`** | New env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VAPID_PUBLIC_KEY`. |
| **`s2g worker`** | No new requirements. |

Secrets stay in gitignored `server/.env.local` locally. New local ports, none in use on 2026-11-05 **[V]**: LiveKit 17880, 17881, 17882/udp; notifier health 18090.

## 11. Unverified

| Item | How to close it | Blocks |
|---|---|---|
| Echo cancellation against cross-origin iframe audio on speakers | Two laptops, real rooms | Voice default advice |
| iOS: mic use changing audio routing or dropping iframe volume; AirPods switching to HFP | Real-device pass | Voice exit |
| iOS: YouTube iframe `setVolume` ignored as expected | Real device | Ducking copy |
| `RemoveParticipant` via hand-written Twirp | Compose integration test | B1 |
| Token refresh past 10 minutes on self-hosted | 15-minute soak | B1 |
| Voice over real networks, NAT, and how many fail without TURN | Two-network test, then VPS | Owner TURN call |
| LiveKit VPS sizing | Measure on deploy | Deployment |
| Are bare video IDs "API data"? | We take the strict reading; legal view if it matters | None |
| `guest_access=false` read as gating under YouTube's playback rule | Likely fine, since it gates a private room, not YouTube; owner review | Default stays `true` |
| Guests filling a 50-person crew room and locking members out | Watch usage; reserve slots if seen | None |
| `time()` during YouTube ads in catch-up; ducking during ads | Test with a real ad | A4 |
| Goose out-of-order behavior in the pinned version | Read source | T0 |
| `webpush-go` v1.4.0 (January 2025) re-signs VAPID per send; Apple asks for hourly at most | Read source, otherwise cache the JWT in `notify` | B2 |
| Vimeo `setPlaybackRate` by plan; `speed` default conflicts between docs; eligible account | Test on a real embed | Vimeo sync target |
| Twitch `parent=127.0.0.1`, pre-roll ad detection, seek-only drift | Local test | B3 |
| Live HLS | Not in v1 | None |
| Competitor absence claims; Danmaku details | Hands-on trial before any marketing claim | None |
| Safari and physical phones in general: still untested per `measurements.md` | Real-device pass | Voice, push exits |

## 12. Owner decisions

Each has a default, so no track blocks on them unless marked.

| # | Decision | Default in this spec |
|---|---|---|
| 1 | **Ducking on YouTube.** Documented `setVolume`, but the policy bars modifying audio and ducking would also apply to ads **[U]** | Toggle exists, off for YouTube, on elsewhere |
| 2 | **TURN/TLS on 443:** extra domain and Traefik passthrough, or accept failed voice on strict networks | Skip in v1 |
| 3 | **Privacy policy page.** YouTube and Vimeo both require one, and crews now store chat and reactions. **Blocks public launch of crews and Vimeo** | Owner supplies text |
| 4 | **Direct media abuse stance** (`plan.md` decision 6): open URLs let anyone stream anything via our UI, though we do not proxy | Stays off |
| 5 | **Dailymotion:** pay for Edge or drop | Deferred |
| 6 | **Twitch:** production domain for `parent`; accept that phones under 400 px wide must rotate; URL-only titles in v1 | Yes to both, after the domain is set |
| 7 | **Vimeo account** for the Addendum, and note 3.5 bars charging users without written authorization. Twitch and YouTube limit charging too, so any future fees need review | Owner creates account |
| 8 | **Guests talking in voice** | Allowed |
| 9 | **Public recap sharing** | Available, off per recap |
| 10 | **Retention for crew chat and moments** | Kept until crew deletion, or until the video leaves `media` |
| 11 | **Production Clerk keys.** Local keys exist **[V]**; crews need them in every environment | Required at deployment |
| 12 | **Email provider** | None; web push only |

## 13. Sources

Fetched 2026-11-05:

- **YouTube:** [Developer Policies](https://developers.google.com/youtube/terms/developer-policies), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- **LiveKit:** [docs](https://docs.livekit.io), [releases](https://github.com/livekit/livekit/releases)
- **Coolify:** [docs](https://coolify.io/docs)
- **Twitch:** [embed docs](https://dev.twitch.tv/docs/embed/), [Developer Agreement](https://legal.twitch.com/legal/developer-agreement/)
- **Vimeo:** [oEmbed](https://developer.vimeo.com/api/oembed/videos), [Player SDK](https://developer.vimeo.com/player/sdk/reference), [Developer Addendum](https://developer.vimeo.com/guidelines/terms) (updated 2026-03-09)
- **Dailymotion:** [Player Library Script](https://developers.dailymotion.com/docs/player-library-script), [Web SDK methods](https://developers.dailymotion.com/reference/web-sdk-player-methods), FAQ (2026-10-22)
- **Apple:** Sending web push notifications in web apps and browsers; Declarative Web Push
- **Competitors:** w2g.tv, kosmi.io, teleparty.com, rave.io public pages, and AniDachi
