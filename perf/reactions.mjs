// A crew room at its limits: every viewer reacts as fast as the server allows, and
// one of them seeks once a second. Reports how long the seek takes to reach the
// others, which is what capture must not slow. Run only against the local stack.
//   NODE    the server (http://127.0.0.1:18080)
//   SLUG    a crew room with guest access on
//   REDIS   where its rate limits live (redis://127.0.0.1:63809)
import { setTimeout as sleep } from 'node:timers/promises';
import Redis from 'ioredis';

const NODE = process.env.NODE ?? 'http://127.0.0.1:18080';
const SLUG = process.env.SLUG;
const CLIENTS = Number(process.env.CLIENTS ?? 50);
const SECONDS = Number(process.env.SECONDS ?? 60);
const REACTIONS_PER_SECOND = 2; // The hub's per-connection limit.
const SEEK_EVERY_MS = 200; // One viewer's control limit is 5 a second.

if (!SLUG) throw new Error('SLUG is required');
const redis = new Redis(process.env.REDIS ?? 'redis://127.0.0.1:63809');

const clearLimits = async () => {
  const keys = await redis.keys('limit:*');
  if (keys.length) await redis.del(keys);
};

const join = async () => {
  const response = await fetch(`${NODE}/v1/rooms/${SLUG}/ticket`, { method: 'POST' });
  if (!response.ok) throw new Error(`ticket: ${response.status} ${await response.text()}`);
  const { ticket } = await response.json();
  const socket = new WebSocket(`${NODE.replace('http', 'ws')}/v1/ws?ticket=${ticket}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join timed out')), 20_000);
    socket.onerror = () => reject(new Error('socket error'));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.t === 'welcome') {
        clearTimeout(timer);
        resolve({ socket, welcome: message.d });
      }
    };
  });
};

const viewers = [];
for (let i = 0; i < CLIENTS; i += 1) {
  if (i % 10 === 0) await clearLimits();
  viewers.push(await join());
}
const [driver, watcher] = viewers;
const item = driver.welcome.state.playback.item;

const sentAt = new Map();
const latencies = [];
watcher.socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.t !== 'playback') return;
  const at = sentAt.get(message.d.playback.pos);
  if (at !== undefined) latencies.push(performance.now() - at);
};

const emojis = ['😂', '❤️', '🔥', '😮', '👏', '😭'];
let reactions = 0;
const timers = viewers.map((viewer, index) =>
  setTimeout(() => {
    viewer.timer = setInterval(() => {
      viewer.socket.send(JSON.stringify({ t: 'react', d: { emoji: emojis[index % emojis.length] } }));
      reactions += 1;
    }, 1000 / REACTIONS_PER_SECOND);
  }, (index * 1000) / REACTIONS_PER_SECOND / CLIENTS),
);

const started = performance.now();
let pos = 1;
while (performance.now() - started < SECONDS * 1000) {
  pos += 1;
  sentAt.set(pos, performance.now());
  driver.socket.send(JSON.stringify({ t: 'seek', d: { item, pos, ct: Date.now() } }));
  await sleep(SEEK_EVERY_MS);
}
timers.forEach(clearTimeout);
for (const viewer of viewers) clearInterval(viewer.timer);
await sleep(2000);

const sorted = latencies.toSorted((a, b) => a - b);
const at = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10;
console.log(JSON.stringify({ clients: CLIENTS, seconds: SECONDS, reactions, seeks: pos - 1, delivered: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) }));

for (const viewer of viewers) viewer.socket.close();
await redis.quit();
