// Measures the legacy Socket.io server. Run it only against the local stack in
// deploy/compose.yaml: it writes users and rooms straight into both stores.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import Redis from 'ioredis';
import pg from 'pg';
import { io } from 'socket.io-client';

const URL = process.env.URL ?? 'http://127.0.0.1:4100';
const ROOMS = Number(process.env.ROOMS ?? 40);
const MEMBERS = Number(process.env.MEMBERS ?? 5);
const RATE = Number(process.env.RATE ?? 1); // events per second per room
const SECONDS = Number(process.env.SECONDS ?? 30);

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
};
const summary = (values) => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
  max: percentile(values, 1),
});

const db = new pg.Client('postgres://s2g:s2g@127.0.0.1:54339/s2g');
await db.connect();
const redis = new Redis('redis://127.0.0.1:63809');

const video = { id: 'dQw4w9WgXcQ', platform: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Seed', author: 'Seed', thumbnailUrl: '' };
const roomInfo = (id) => ({ id, playingIndex: 0, playlist: [video], currentVideo: video, playedSeconds: 0, playedTimestampUpdatedAt: '0', isPlaying: true });

const seedRoom = async () => {
  const users = Array.from({ length: MEMBERS }, () => randomUUID());
  for (const id of users) {
    await db.query('INSERT INTO "user" (id, username) VALUES ($1, $2)', [id, `perf-${id.slice(0, 8)}`]);
  }
  const slug = `perf-${randomUUID()}`;
  const { rows } = await db.query(
    'INSERT INTO room (slug, "isPublic", "creatorId") VALUES ($1, true, $2) RETURNING id',
    [slug, users[0]],
  );
  const id = String(rows[0].id);
  await redis.hset('room_info', id, JSON.stringify(roomInfo(id)));
  return { id, slug, users };
};

const join = (slug, uid) =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = io(URL, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => reject(new Error('join timed out')), 20_000);
    socket.on('connect', () => socket.emit('req_join_room', { uid, slug }));
    socket.on('res_joined_room', () => {
      clearTimeout(timer);
      resolve({ socket, joinMs: performance.now() - started });
    });
    socket.on('connect_error', reject);
  });

const rooms = [];
for (let i = 0; i < ROOMS; i += 1) rooms.push(await seedRoom());

const joins = [];
const propagation = [];
let received = 0;
let sent = 0;

for (const room of rooms) {
  room.sentAt = new Map();
  room.sockets = await Promise.all(
    room.users.map(async (uid, index) => {
      const { socket, joinMs } = await join(room.slug, uid);
      joins.push(joinMs);
      if (index > 0) {
        socket.on('res_streaming_events', ({ playedSeconds }) => {
          const at = room.sentAt.get(playedSeconds);
          if (at !== undefined) {
            propagation.push(performance.now() - at);
            received += 1;
          }
        });
      }
      return socket;
    }),
  );
}

const started = performance.now();
let tick = 0;
while (performance.now() - started < SECONDS * 1000) {
  tick += 1;
  for (const room of rooms) {
    room.sentAt.set(tick, performance.now());
    room.sockets[0].emit('req_streaming_events', { isPlaying: tick % 2 === 0, timestamp: tick });
    sent += 1;
  }
  await sleep(1000 / RATE);
}
await sleep(3000);

// Concurrent queue edits: every member adds at once, so the stored queue should
// grow by exactly the number of adds.
const raceRoom = rooms[0];
const addsPerMember = 20;
for (let i = 0; i < addsPerMember; i += 1) {
  for (const socket of raceRoom.sockets) {
    socket.emit('req_add_to_playlist', { videoInfo: { ...video, id: `race-${i}` } });
  }
}
await sleep(3000);
const stored = JSON.parse(await redis.hget('room_info', raceRoom.id));
const expectedAdds = addsPerMember * raceRoom.sockets.length;

console.log(
  JSON.stringify(
    {
      config: { rooms: ROOMS, members: MEMBERS, ratePerRoom: RATE, seconds: SECONDS },
      joinMs: summary(joins),
      propagationMs: summary(propagation),
      delivery: { sent, expected: sent * (MEMBERS - 1), received },
      queueRace: { expectedAdds, survived: stored.playlist.length - 1 },
    },
    null,
    1,
  ),
);

for (const room of rooms) for (const socket of room.sockets) socket.close();
await redis.quit();
await db.end();
