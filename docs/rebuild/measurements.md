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
