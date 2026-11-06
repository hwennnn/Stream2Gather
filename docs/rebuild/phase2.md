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

