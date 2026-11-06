# Stream2Gather rebuild plan

> **Implementation notes (Opus).** Where the build differs from Fable's plan:
> - Measured on 2026-11-05: see `measurements.md`. The socket hop is fast already; lost queue edits, page load and embed failures are the real problems. Error 150 is confirmed, so the Referer hypothesis in section 5 is ruled out.
> - The legacy baseline did not need Firebase credentials for sync numbers, because the legacy socket trusts a client-sent uid.
> - Each state change broadcasts the playback state or the whole queue, not deltas. Queues are small, so the Redis stream and gap repair are dropped; `pong` carries the version and a client that falls behind asks for a snapshot.
> - Plain `net/http` and `pgx` instead of `huma` and `sqlc`, and a JSON room snapshot instead of `queue_items` and `room_playback`, until there is a reason for more.

Markers: **[V]** verified in this repo or in official docs fetched 2026-11-05; **[U]** not verified, treat as a hypothesis.

## 1. Findings from the code

All seven observations in the brief hold **[V]**. Additional findings:

- **Join waterfall is serial.** `AuthContext.tsx` blocks every page on the `me` query. `room/[slug].tsx` then connects the socket, joins, runs the room GraphQL query, lazy-loads react-player, and only then loads the YouTube API. This is the likeliest latency cause, but it is unmeasured **[U]**.
- **Client supplies queue metadata.** `handleAddToPlaylist` and `handlePlayNewVideo` store a client-sent `VideoInfo` (title, url, thumbnail) unvalidated.
- **Queue operations are index-based.** `removingIndex` and `playingIndex` race with each other; `handlePlayNextVideo` dedupes by index.
- **Any socket in a room can control playback.** There are no roles.
- **API authorization gaps.** `deleteRoom` has no ownership check. `users`, `usersWithRelations`, `rooms` and `roomMessages` are unauthenticated. `rooms` loads every room with its members.
- **Presence leaks.** Members are removed only in the disconnect handler, so a server crash leaves ghosts. A second tab is rejected as `ALREADY_JOINED`.
- **Room lifecycle is unused.** Nothing in the resolvers or socket handlers writes `isActive`, `isTemporary` or `bannedUsers`.
- **The current player breaks YouTube policy.** `Player.tsx` sets `pointerEvents: 'none'` and draws its own controls over the player. YouTube's required minimum functionality forbids overlays on any part of the player and requires at least 200×200px **[V]**.
- **Other debt.** `synchronize: true` and `logging: true` in TypeORM, Node 14 Dockerfile, chat capped at 128 characters and paged by OFFSET, paid `@chakra-ui/pro-theme` dependency.
- **Old branches are worthless.** `migrate-chakra-ui` and `hwennnn-patch-1` are fully merged. `auth-layout`, `resolve-module-mapping` and `test-socket-disconnect` each hold one commit named "test" or "testing" from 2022–23. Delete them.
- **No secrets in history.** A scan for Google keys, private keys and session secrets found nothing; only `.env.example` files were ever tracked.

## 2. Architecture

```
Browser (Vite SPA) ── HTTPS /v1 ──► Go API ──► Postgres (durable)
        └─────────── WS /v1/ws ───► Go room hub ──► Redis (live state, fan-out)
                                    Go worker ◄──► Temporal (background jobs)
                                    telemetry batcher ──► ClickHouse ──► Grafana
```

- **One Go binary, two modes.** `s2g serve` runs HTTP, WebSocket and the embedded static web build. `s2g worker` runs Temporal workers.
- **Authority is a versioned room document in Redis**, changed only by compare-and-set. Any node can process any command, so there is no room ownership, lease or failover to build.
- **Logic is a pure Go reducer**: `Apply(state, cmd, now) → (state', events, err)`. It is the unit under test.

| Store | Job here | Kept out of |
|---|---|---|
| Postgres | Users, rooms, membership, queue and playback snapshots, chat, media and search cache, quota ledger | Per-event playback writes |
| Redis | Live room state, per-room event stream for resume, pub/sub between nodes, presence, rate limits, WS tickets, hot metadata cache | Anything that must survive a flush |
| Temporal | 30-day YouTube metadata refresh, temporary-room expiry, Clerk user sync and deletion, legacy import | The playback path: no per-room workflows, no signals for play or pause |
| ClickHouse | Sync telemetry, join and first-frame timings, player errors by video and country, web vitals, quota usage | Product reads, chat, state |

Go libraries: `net/http` with `huma` (OpenAPI 3.1), `pgx` + `sqlc`, `goose`, `go-redis/v9`, `coder/websocket`, Temporal Go SDK, `clickhouse-go/v2`, `slog`.

Local compose (project `s2g`, Temporal namespace `s2g`):

| Service | Port |
|---|---|
| Postgres (`shm_size: 1g`) | 54339 |
| Redis | 63809 |
| ClickHouse HTTP / native | 18133 / 19010 |
| Grafana | 3011 |
| Temporal dev server / UI | 7235 / 8235 |
| API / web dev | 18080 / 5273 |

Never touch the owner's Temporal on 7233. Run k6 only through `grafana/k6`.

### Open calls

| Question | Decision | Reason |
|---|---|---|
| Next.js or Vite | Vite, React 19, TanStack Router and Query | The app is a client-side real-time SPA and uses no SSR today. Go serves the build and templates OG tags into `index.html` for `/r/{slug}`. This removes the Node server. |
| Chakra | Replace with Tailwind v4, shadcn/ui and Motion | Chakra v2 is legacy and v3 is a rewrite anyway. This drops runtime CSS-in-JS and the paid theme. |
| WebSocket | `coder/websocket`, JSON envelope | Rooms send a few messages per second. JSON is readable in devtools, Playwright and k6. Protobuf buys nothing here. |
| Types | `openapi-typescript` for HTTP, `tygo` for WS structs | CI fails if generated files differ. |
| Frontend survival | Almost none as code | Port the ideas only (see section 10). |

## 3. Room state ownership

- **`room:{id}:state`** holds JSON `{version, playback, queue[], settings}`. A Lua script sets it only if the version matches, then does `XADD room:{id}:log MAXLEN ~1000` and `PUBLISH room:{id}`. On conflict, re-read, re-apply and retry up to 5 times.
- **Per-node hub.** One goroutine per locally active room serialises local commands, caches state and fans out to sockets. It is not the authority.
- **Fan-out.** Each node keeps one pub/sub connection and subscribes per room. A sequence gap is filled with `XRANGE`.
- **Presence.** `room:{id}:presence` is a sorted set of `user:conn → lastSeen`, refreshed every 10s and pruned after 30s. Several tabs per user are allowed and deduped by user.
- **Durability.** Queue and playback snapshot go to Postgres, debounced 5s and on last leave. A Redis miss rehydrates from Postgres. Chat inserts straight into Postgres, then publishes; it does not bump the room version.
- **No server timers.** Every state is "position p at server time T, rate r", and T may be in the future.

## 4. Sync protocol

**State**: `{item, status: idle|playing|paused, pos, at, rate, version}`. Expected position is `pos + (serverNow − at) × rate` while playing.

- **Authority and ordering.** The server orders commands by CAS. Every playback command carries the queue `item` id; a mismatch is rejected, so a stale `seek` or duplicate `ended` cannot affect the next video. `ended` is accepted once and only near the known duration.
- **Clock sync.** The client sends `ping{t0}` and gets `pong{t0, ts}`. Offset is `ts + rtt/2 − t1`, on `performance.now()`. Send 5 pings at join, then one every 10s; use the lowest-RTT sample of the last 8.
- **Latency compensation.** Commands carry `pos` and `ct`, the client's estimate of server time at sampling. The server sets `at = clamp(ct, now−2s, now)`.
- **Synchronised start.** A media change or resume sets `at = now + 3s`. Clients cue, send `ready`, and hold. When all present clients are ready the server pulls `at` in to `now + 300ms`. Everyone starts at `at` regardless.
- **Drift correction.** A 1 Hz loop runs while playing, with thresholds set from M0 measurements:

| Drift | Fine-rate sources (HTML5; Vimeo **[U]**) | Discrete-rate sources (YouTube) |
|---|---|---|
| under 150ms | Nothing | Nothing |
| ahead, up to 2s | Rate 0.95 | Pause for the drift duration |
| behind, up to 3s | Rate 1.05 | Rate 1.25 for `drift/0.25` s, if M0 shows it is tolerable; otherwise seek |
| beyond | Seek to expected plus measured seek-settle time | Same, at most one corrective seek per 10s |

- **Buffering.** A buffering viewer does not stall the room. They report `status: buffering` and catch up. A room setting "wait for everyone" is off by default.
- **Ads.** Never blocked, skipped or seeked through. A viewer whose time is not advancing while the player is not paused reports `status: stalled`; the room continues and they catch up afterwards. The IFrame API has no ad event **[U]**, so M0 measures this.
- **Late joiners.** `welcome` carries the full snapshot. The client loads at expected position plus lead, then the drift loop takes over. The Join click is the user gesture for autoplay. If playback is still blocked after 2s, start muted with a "Tap to unmute" control outside the player. Safari behaviour is **[U]**.
- **Reconnect.** Backoff 250ms to 5s with jitter, a new ticket, then `hello{resume: seq}`. The server replays from the stream or sends a snapshot. Presence has a 15s grace. The client keeps playing by extrapolation while offline.
- **Native controls stay on.** User intent inside the iframe is inferred from state changes and time discontinuities over 1s with no pending programmatic operation. Player events are ignored for up to 1.5s after applying a remote command.
- **Who may control.** Roles are host, mod and member, and guests count as members. `control_mode` is `everyone` (default) or `hosts`; `queue_mode` likewise. A viewer without permission is snapped back with a toast. Limits: 5 playback commands per second per connection; seek is sent on release.

## 5. Source adapters

```ts
interface PlayerAdapter {
  caps: { seek: boolean; live: boolean; rates: number[] | {min: number; max: number} };
  mount(el: HTMLElement, ref: MediaRef, o: {startAt: number; muted: boolean}): Promise<void>;
  play(): Promise<void>; pause(): Promise<void>; seek(s: number): Promise<void>;
  setRate(r: number): void; getTime(): Promise<number>; getDuration(): Promise<number>;
  setVolume(v: number): void; setMuted(m: boolean): void;
  on(e: 'state' | 'error', cb): () => void;  // state: ready|playing|paused|buffering|ended
  destroy(): void;                            // error.kind: unavailable|region|embed_disabled|network|unknown
}
```

```go
type Source interface {
    ID() string
    Match(u *url.URL) (MediaRef, bool)
    Resolve(ctx context.Context, ref MediaRef) (Media, error) // title, author, duration, thumb, live, embeddable, region allow/block
    Search(ctx context.Context, q, region string) ([]Media, error) // may return ErrUnsupported
    RefreshEvery() time.Duration
}
```

`SyncController` in TypeScript owns all sync logic and takes an injected adapter and clock. A `fake` adapter exists in dev and test builds only.

| Source | Player | Limits and terms | Sync mode |
|---|---|---|---|
| YouTube | IFrame API, unmodified, native controls | No overlays, at least 200×200, one autoplaying player per page **[V]**. Stored API data deleted or refreshed within 30 days **[V]**. `search.list` has its own bucket of 100 calls a day; other reads share 10,000 units; `videos.list` costs 1 **[V]**. Key in `x-goog-api-key`. | Seek, discrete rates |
| Direct HLS or MP4 | `<video>` with hls.js | HTTPS only. HLS needs CORS. No media proxying. The client probes duration; the server does not fetch user URLs. | Fine rate, best sync |
| Twitch | Embed JS v1 | `parent` must match the embedding domain, minimum width 400 **[V]**; minimum height 300 and HTTPS **[U]**. Helix metadata needs a client id and secret. Live has no seek; rate control in the embed is **[U]**. | VOD: seek only. Live: same channel, no position sync |
| Vimeo | player.js | Embedding obeys the uploader's domain privacy. oEmbed gives metadata without a key. No search. Rate control depends on the uploader's plan **[U]**. | Seek, rate where allowed |
| Dailymotion | Player Embed SDK | Needs a Player ID from a Dailymotion partner account **[U]**. The old iframe API is deprecated. | Seek **[U]** |

**Failed videos.** The adapter emits `error`; the client sends `media_error{item, kind, code}`. That viewer sees an "Unavailable for you" card with an "Open on YouTube" link, and chat and presence carry on. If more than half of present viewers fail within 5s, the server skips the item and marks it `failed`.

**Regions.** `Resolve` stores `regionRestriction` and `embeddable`; non-embeddable items are rejected at add time. Queue items show a badge when a viewer's country is blocked. The country comes from a CDN header in production **[U]**.

**The 18-of-50 embed failures.** One hypothesis is a missing Referer or `origin` in the headless test page **[U]**. M0 tests this.

**Search budget.**
- Pasting a URL is the main path and costs 1 unit.
- Search runs on submit only (it already does **[V]**).
- Results are cached by normalised query and region for 7 days in Postgres, with a hot copy in Redis.
- The daily ledger is keyed by Pacific date: 90 calls, 10 held in reserve, per-user caps of 3 for guests and 10 for signed-in users.
- When the budget is spent, the UI says so and shows trending (`videos.list chart=mostPopular`, cached 1h).

## 6. API contract

HTTP, JSON, under `/v1`:

| Route | Purpose |
|---|---|
| `GET /config` | `{clerkEnabled, sources[]}` |
| `POST /session/guest {name?}` | Sets the httpOnly guest cookie |
| `GET /me`, `GET /me/rooms` | Identity and own rooms |
| `POST /rooms {url?}` | Creates a room; creates a guest session if none |
| `GET /rooms/{slug}` | Public preview: name, now playing, member count |
| `PATCH`, `DELETE /rooms/{slug}` | Host only |
| `POST /rooms/{slug}/ticket` | Single-use WS ticket, 30s |
| `GET /rooms/{slug}/messages?before=&limit=` | Keyset pagination |
| `POST /media/resolve {url}` | Returns `Media` |
| `GET /media/search?source=&q=` | Returns `{items, remaining}` |
| `GET /media/trending?source=` | Cached trending |
| `POST /telemetry` | Batched; `sendBeacon` allowed |
| `POST /webhooks/clerk` | Svix-verified |
| `GET /healthz`, `/readyz` | Health |

WebSocket `/v1/ws?ticket=`, envelope `{v:1, t, id?, seq?, d}`:

- **Client to server**: `hello{resume?}`, `ping`, `play|pause|seek{item,pos,ct}`, `rate`, `ready{item}`, `ended{item}`, `status{item,state,drift}`, `media_error`, `queue.add{url|ref, playNow?}`, `queue.remove|move|play{itemId}`, `queue.clear`, `skip{item}`, `chat.send{text,nonce}`, `react{emoji}`.
- **Server to client**: `welcome{self, room, state, members, seq, serverTime}`, `pong`, `playback{state, by, cause}`, `queue{op}`, `member.join|leave|update`, `chat`, `react`, `ack{id}`, `error{code, re}`, `kicked`, `room.closed`.

The client sends only URLs or ids. The server resolves all titles and thumbnails.

## 7. Auth and guests

- **Guests can create and join rooms from a link with no account.** This is what lets everything work without Clerk keys. A guest gets a server-signed EdDSA token in an httpOnly cookie, with `sub = g_<ulid>` and an editable generated name.
- **Clerk** is enabled only when its keys are present. The server verifies JWTs against JWKS; `ClerkProvider` mounts only if `VITE_CLERK_PUBLISHABLE_KEY` is set; otherwise the sign-in button is hidden.
- **Signing in** claims the guest's rooms and makes them permanent. Guest rooms expire after 24h idle.

## 8. Data model and migration

```
users(id uuid pk, kind guest|clerk|legacy, clerk_id unique null, legacy_firebase_uid unique null,
      display_name, avatar_url, email null, created_at, last_seen_at)
rooms(id uuid pk, slug unique, name, owner_id, visibility link|public|private, invite_token null,
      control_mode, queue_mode, max_members default 50, is_temporary, expires_at, closed_at, legacy_id null, timestamps)
room_members(room_id, user_id, role host|mod|member, joined_at, last_seen_at, banned_at, pk(room_id,user_id))
media(id bigserial, source, source_id, url, title, author, duration_ms, thumbnail_url, is_live, embeddable,
      region_allow text[], region_block text[], fetched_at, unique(source, source_id))
queue_items(id text pk /*ulid*/, room_id, media_id, added_by, position double, state queued|playing|played|failed|removed, added_at)
room_playback(room_id pk, item_id, status, pos_ms, rate, updated_at)
messages(id bigint identity pk, room_id, user_id, author_name, body varchar(500), created_at, deleted_at; index(room_id, id desc))
search_cache(source, query_norm, region, media_ids bigint[], fetched_at, pk(source, query_norm, region))
quota_usage(day date, bucket text, used int, pk(day, bucket))
```

Migration is an optional one-off `s2g migrate-legacy --from <dsn>`:

| Legacy | New |
|---|---|
| `user` (id is the Firebase uid) | `users` with `kind=legacy`, `legacy_firebase_uid`; linked on first Clerk sign-in with the same verified email |
| `room` | `rooms`: `isPublic → visibility`, `creatorId → owner_id`, increment id → `legacy_id` |
| `room_members_user` (TypeORM default name **[U]**) | `room_members` |
| `bannedUsers[]` | `room_members.banned_at` |
| `message` | `messages` |
| Redis `room_info` | Dropped; it is ephemeral |

Whether a production database exists is **[U]**.

## 9. UI and UX

- **Layout.** Dark and cinema-first. The player is unobstructed with native controls. Our bar sits below it: room scrubber, play and pause, and a sync pill ("In sync · 40ms", "Catching up", "Ad playing, room continues").
- **Right rail.** Chat, Queue and People tabs, collapsible for theatre mode. On mobile the player sticks to the top with tabs beneath.
- **Presence.** Avatars carry status rings for buffering, ad and unavailable. Actions are attributed: "Maya jumped to 12:40".
- **Adding video.** One omnibox (Cmd+K): paste any supported URL for an instant preview card, or type and press Enter to search. The queue supports drag reorder, "play next" and per-viewer availability badges.
- **Extras.** Ephemeral emoji reactions over WS, never stored and drawn outside the player. View transition from landing to room.

**First 10 seconds, creator.**
1. Landing is static with no auth wait: one input, "Paste a YouTube link", and a "Start empty room" button.
2. Submit calls `POST /rooms`, which also creates the guest session, then navigates to `/r/{slug}`.
3. The link is copied to the clipboard on that same click, with a toast and a Share button (Web Share on mobile). The video starts, because the click was the gesture.
4. The name is auto-generated and editable inline. Nothing blocks.

**First 10 seconds, invitee.** The link unfurls with the room name and current video through OG tags. The page shows what is playing and who is there, with a prefilled name and one Join button. That click is the autoplay gesture, and they land in sync.

## 10. Keep, port, delete

- **Keep**: `LICENSE`, `docs/` images, the README (rewritten), and slug-style room URLs.
- **Port as ideas**: the room join-error states, the zustand store shape, `parseYoutubeUrl` (rewritten with `URL` parsing per source), time formatting, the trending and search tabs.
- **Delete at M5**, after parity: all of `backend/` and `frontend/`, including Apollo, type-graphql, TypeORM, Socket.io, Firebase, express-session, react-player, Chakra, formik and codegen. Also delete the stale remote branches and close the dependabot branches.

Layout: `server/` (`cmd/s2g`, `internal/{room,hub,store,source,auth,api,telemetry,workflows}`, `migrations/`), `web/` (`src/{routes,features,sync,players,ui,api}`), `deploy/` (compose, Grafana, ClickHouse DDL), `e2e/`, `load/`.

## 11. Test strategy

- **Reducer.** Table and property tests (`rapid`): versions are monotonic, queue invariants hold, stale-item commands are rejected.
- **CAS integration.** Real Redis, 50 goroutines × 200 commands across two server instances with `-race`. Accepted commands must equal the final version and the stream length.
- **SyncController.** Vitest with a fake player and clock, injecting latency, jitter, clock offset and stalls; assert convergence time and no oscillation.
- **Adapter conformance.** One suite that every adapter must pass.
- **Multi-client e2e.** Playwright with three contexts in one room. `window.__s2g.sample()` returns `{serverNow, time, state}`. Assert pairwise drift after play, pause, seek, late join, CDP throttling on one client, and an offline toggle. CI uses the `fake` source and a local MP4. Real YouTube runs are tagged `@live`, headed where possible, and do not block CI.
- **Load.** k6 WebSocket scenarios in Docker; latencies are read from ClickHouse.
- **CI.** Lint, `go test -race`, Vitest, generated-types diff, compose-backed e2e, gitleaks, `govulncheck`.

## 12. Security

- **Identity** comes only from the verified token behind the WS ticket (`GETDEL`, 30s). Origin allowlist on upgrade. 8KB message cap.
- **Authorization** by role is checked in the reducer and on every HTTP route. Room deletion and settings are host only.
- **Rate limits** in Redis: per connection, per user, and per IP for room creation and guest sessions. Chat has a length cap and slow mode and is rendered as text.
- **CSP** with `frame-src` and `script-src` limited to the enabled player origins. `Referrer-Policy: strict-origin-when-cross-origin`.
- **Direct URLs**: `https` only, no server-side fetch. If probing is ever added, use a dialer that blocks private ranges and re-validates redirects.
- **Secrets** live in a gitignored `.env`; `.env.example` holds names only. Gitleaks runs in pre-commit and CI. YouTube keys go in the header, never in URLs or logs.
- **Runtime**: distroless non-root image, least-privilege database role, `sqlc` parameterised queries.

## 13. Metrics and milestones

Client samples go to ClickHouse table `events`. Targets are provisional until M0.

| Metric | Definition | Target |
|---|---|---|
| Page load | Landing LCP p75, Fast 4G | under 1.5s; initial JS at most 150KB gzip |
| Join time | Navigation start to `welcome` | p50 under 400ms, p95 under 1s |
| First frame | Navigation start to first `playing` | p50 under 2.5s, p95 under 5s; our share (`welcome` to load call) under 100ms |
| Propagation | Sender `ct` to receiver receipt | p50 under 50ms, p95 under 150ms |
| Drift | Pairwise position gap at 1 Hz, steady state | YouTube p95 under 400ms; HTML5 p95 under 80ms |
| Resume | Socket loss to back within threshold | under 3s |

| # | Scope | Measurable exit |
|---|---|---|
| M0 | Compose stack, telemetry tables, Grafana board. Spikes: the 50-video embed study (headed vs headless, with and without Referer and `origin`, error codes logged); `getCurrentTime` resolution; seek-settle time; 1.25× nudge; ad behaviour. Legacy baseline if Firebase credentials exist. | `docs/measurements.md` holds numbers for every spike, each embed failure is classified, and thresholds in section 4 are fixed |
| M1 | Go skeleton, guest session, create and join, WS `welcome`, presence, reducer with CAS, `fake` adapter, telemetry | CAS test loses 0 updates in 10k commands over 2 nodes; k6 at 1,000 rooms × 5 clients gives propagation p95 under 150ms and join p95 under 1s |
| M2 | YouTube adapter, `SyncController`, clock sync, synchronised start, late join, reconnect, failed-video handling | 3-client run of 5 minutes meets the drift targets on MP4 (CI) and YouTube (`@live`); seek converges in under 2s; a failing video leaves the room working in an automated test |
| M3 | Queue, resolve, search with cache and ledger, trending, chat | 200 simulated searches against a stubbed API make at most 90 upstream calls; 0 lost queue operations under concurrency; chat pages by keyset |
| M4 | Full UI, OG tags, mobile | Create-to-link-copied in one click and under 1s; Lighthouse performance at least 95 with LCP under 1.5s; axe reports 0 serious issues |
| M5 | Clerk, roles, room claim, Temporal workflows, legacy import, delete legacy code | The full suite passes with no Clerk keys; sign-in e2e passes with keys; a time-skipping test shows no `media` row older than 30 days and expired guest rooms closed |
| M6 | Hardening and multi-node | Killing one of two nodes resumes all clients in under 3s; 5,000 sockets on one node hold propagation p95 under 150ms; the security checklist and gitleaks are clean |
| M7 | Direct HLS and MP4, then Twitch, Vimeo, Dailymotion | Per source: the conformance suite passes and the 3-client drift test meets that source's target |

## 14. Decisions for the owner

1. **Legacy data.** Does a production database exist and is it worth importing? If not, drop the import and the `legacy` user kind.
2. **Baseline.** Supply Firebase credentials for a legacy baseline, or accept absolute targets only.
3. **YouTube.** Create an API-restricted key, publish the required privacy policy and terms links, and decide whether to apply for more search quota (this triggers a compliance audit).
4. **Clerk.** Supply keys and choose sign-in methods.
5. **Guest powers.** I recommend guests may create rooms, control playback and add to the queue by default. Confirm, along with the 50-member cap.
6. **Direct URLs.** Allowing arbitrary user-supplied media needs an abuse and takedown stance. It can ship disabled.
7. **Accounts for other sources.** Twitch needs a client id and secret, and a production domain for `parent`. Dailymotion needs a partner Player ID.
8. **Hosting and CDN.** This sets where viewer country comes from and the production WebSocket path.
9. **Chat profanity filter.** The legacy app uses `bad-words`. Keep or drop.
