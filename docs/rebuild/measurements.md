# Measurements

All numbers come from one MacBook on 2026-11-05, so network delay is not included.

## Legacy baseline

Sync, from `perf/legacy-baseline.mjs` over WebSocket transport:

| Load | Join p50 / p95 | Event propagation p50 / p95 / p99 | Delivered |
|---|---|---|---|
| 40 rooms, 5 members, 1 event/s per room | 10 / 14 ms | 9 / 14 / 17 ms | 3,200 of 3,200 |
| 100 rooms, 8 members, 5 events/s per room | 12 / 17 ms | 21 / 29 / 34 ms | 69,300 of 69,300 |

The socket hop is not the latency problem at these loads.

Queue edits are the correctness problem. When every member added at once, 2 of 100 adds survived with 5 members, and 2 of 160 with 8. Each handler reads, changes and rewrites the whole room.

Page load, from a production build:

- First-load JS: 259 kB on `/`, 319 kB on `/room/[slug]`.
- On a throttled phone profile (150 ms latency, 1.6 Mbps, 4x CPU slowdown), first paint took 2.4 s, and the page still had no text about 8 s after navigation in 3 of 3 runs. `AuthContext` blocking on `me` is the likely cause, but this was not isolated.

Not measured: legacy join and first frame through the UI, because they need a Firebase sign-in.

## YouTube embed study

The test used the official IFrame API on a real HTTP page with `origin` set, from a US IP.

| Sample | Playable | Error 150 |
|---|---|---|
| 50 recent Singapore uploads | 32 | 18 |
| 50 trending, US | 40 | 10 |
| 50 trending, SG | 36 | 14 |

- All 150 had `status.embeddable=true`.
- 6 of the failures were rerun in a visible browser and all failed again, so this is not a headless artifact.
- A missing Referer is ruled out as the cause. Error 150 means the owner does not allow embedded playback; the API flag does not capture this.
- `regionRestriction` explains only a few: 3 of the 50 uploads.

Consequence: the API cannot predict playback. Embed failures have to be handled in the room, and remembered so that known-blocked videos can be hidden from search and trending.

## New stack

Same machine and day. These runs share one clock and have no real network, so drift and latency here are best cases.

| Measure | Legacy | New | Target |
|---|---|---|---|
| Concurrent queue adds kept | 2 of 100, 2 of 160 | 64 of 64, 40 of 40 | All |
| Propagation p50 / p95, 100 rooms × 8, 5 events/s | 21 / 29 ms, one server | 22 / 31 ms, two servers | Under 50 / 150 ms |
| Propagation p50 / p95, 1,000 rooms × 5, 1 event/s | Not run | 7 / 12 ms, two servers | Under 50 / 150 ms |
| First-load JS, gzipped | 259 kB | 72 kB | At most 150 kB |
| Landing paint on the throttled phone profile | No text after about 8 s | 0.82 s | Under 1.5 s |
| Landing transfer | 351 kB | 105 kB | |

The legacy and new load scripts differ in one way that matters at 1,000 rooms: `perf/load.mjs` spreads events across each second. Firing all 1,000 rooms in the same instant gave p95 155 ms.

Real browsers, from `e2e/sync.mjs`:

| Measure | Result | Target |
|---|---|---|
| Steady drift between viewers, MP4 | 0-1 ms p95 | Under 80 ms |
| Steady drift between viewers, YouTube | 2-104 ms p95 over three runs | Under 400 ms |
| Late joiner, MP4 | 7-23 ms p95 | |
| Seek reaches every viewer | 0.6 s | Under 2 s |
| Reconnect after a cut socket | 0.3-0.8 s | Under 3 s |
| Injected 0.6 s drift, corrected on MP4 | 12.4 s, by design at a 5% rate change | |

Telemetry from those runs put join at about 310 ms and first frame at 1.2 s p50, 4.7 s p95, mixing MP4 and YouTube and including the 1.5 s shared start. The 310 ms is far above the 10 ms the load test sees for the same join, and the cause is not known yet.

Not tested: real networks, Safari, physical phones, ads, and a server dying while viewers are connected.

## Phase 2: voice and sources

Everything here ran on one loaded development machine, load average 25 to 200. Voice used fake microphones and a real LiveKit on loopback. There are no real networks in these numbers, and they are best cases.

| Measure | Result | Target |
|---|---|---|
| Click to listening, p95 | 212-854 ms over five runs, three near 220 ms | Under 1.5 s across two real networks, not yet run |
| Unmute to audible, p95 | 203-222 ms, one run at 792 ms at load above 100 | Under 500 ms |
| Six people talking, video drift p95 | 46-91 ms, against 24-50 ms for the same six quiet | Unchanged |
| Past token expiry | Still talking after 16 minutes | 15 minutes |
| `RoomPage` with voice | +0.20 kB gz | At most +3 kB |
| Voice chunk | 154.26 kB gz | At most 155 kB |
| Entry JS | Unchanged | Unchanged |
| `player-overlap.mjs` with voice open | 136 checks, 0 problems, all 6 layouts | Pass |
| `make e2e` with LiveKit stopped | No voice failure | Pass |

Six people talking does not meet "unchanged". Talking read 19-41 ms above the quiet control in all three runs, each 20 samples, though under the 80 ms MP4 line in two of them. The third, at 91 ms, was on a loaded machine. Rerun on a quiet machine before calling this settled.

Drift between two viewers, by source:

| Source | p95 | Target | How |
|---|---|---|---|
| HLS, played by the browser | 2 ms, up to 248 ms at high load | As html5 | `e2e/sync.mjs` |
| HLS, through hls.js | 3-6 ms, one run at 917 ms from a single 0.9 s jump | As html5 | `e2e/sync.mjs`, native HLS hidden |
| Vimeo | About 23 ms apart, 22 ms p95 in a single tab | At most 500 ms | Two real Chrome tabs, by hand |
| Twitch VOD | 574 ms, 976 ms in a shorter run | At most 1.5 s | Two headless viewers, autoplay policy off |

Chrome 156 plays HLS itself, so hls.js only runs in browsers that can't. `e2e/sync.mjs` covers both paths and proves which one ran.

Drift checks are sensitive to load. On one day, plain MP4 read 185 ms p95 in `make e2e` at load 120. Alternating master with an older commit at load 34 to 88 then read 1-2 ms and 0-2 ms, so that was not a regression.

Not tested: real networks, real devices, Safari, Firefox, Twitch ads, and a real `https` host refusing CORS. The real-device matrix for voice and push has not been run.
