// Load test for the Go server. Viewers in each room are split across NODES, so
// every event has to cross Redis. Run only against the local stack.
import { setTimeout as sleep } from 'node:timers/promises';
import Redis from 'ioredis';

const NODES = (process.env.NODES ?? 'http://127.0.0.1:18080').split(',');
const ROOMS = Number(process.env.ROOMS ?? 200);
const MEMBERS = Number(process.env.MEMBERS ?? 5);
const RATE = Number(process.env.RATE ?? 1);
const SECONDS = Number(process.env.SECONDS ?? 30);
const BATCHES = 20;
const MEDIA = process.env.MEDIA ?? `${NODES[0]}/sample.mp4`;

const redis = new Redis('redis://127.0.0.1:63809');

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
};
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
const summary = (values) => ({
  n: values.length,
  p50: round(percentile(values, 0.5)),
  p95: round(percentile(values, 0.95)),
  p99: round(percentile(values, 0.99)),
  max: round(percentile(values, 1)),
});

/** Rate limits protect production; this run is one IP doing everyone's work. */
const clearLimits = async () => {
  const keys = await redis.keys('limit:*');
  if (keys.length) await redis.del(keys);
};

const createRoom = async () => {
  const response = await fetch(`${NODES[0]}/v1/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: MEDIA }),
  });
  if (!response.ok) throw new Error(`create room: ${response.status} ${await response.text()}`);
  return response.json();
};

const join = async (slug, node) => {
  const started = performance.now();
  const response = await fetch(`${node}/v1/rooms/${slug}/ticket`, { method: 'POST' });
  if (!response.ok) throw new Error(`ticket: ${response.status}`);
  const { ticket } = await response.json();

  const socket = new WebSocket(`${node.replace('http', 'ws')}/v1/ws?ticket=${ticket}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join timed out')), 20_000);
    socket.onerror = () => reject(new Error('socket error'));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.t === 'welcome') {
        clearTimeout(timer);
        resolve({ socket, joinMs: performance.now() - started, welcome: message.d });
      }
    };
  });
};

const joins = [];
const propagation = [];
const rooms = [];
let sent = 0;
let received = 0;
let closed = 0;

// The server drops a socket after 90s of silence, and most of these only listen.
setInterval(() => {
  for (const viewer of rooms.flatMap((room) => room.viewers)) {
    if (viewer.socket.readyState === WebSocket.OPEN) viewer.socket.send('{"t":"ping","d":{"t0":0}}');
  }
}, 30_000).unref();

for (let i = 0; i < ROOMS; i += 1) {
  await clearLimits();
  const { slug } = await createRoom();
  const room = { slug, sentAt: new Map(), viewers: [], item: '' };

  const viewers = await Promise.all(
    Array.from({ length: MEMBERS }, (_, index) => join(slug, NODES[index % NODES.length])),
  );
  room.item = viewers[0].welcome.state.playback.item;
  room.id = viewers[0].welcome.room.id;
  viewers.forEach((viewer, index) => {
    joins.push(viewer.joinMs);
    viewer.socket.onclose = () => { closed += 1; };
    viewer.socket.onmessage = (event) => {
      if (index === 0) return;
      const message = JSON.parse(event.data);
      if (message.t !== 'playback') return;
      const at = room.sentAt.get(message.d.playback.pos);
      if (at !== undefined) {
        propagation.push(performance.now() - at);
        received += 1;
      }
    };
  });
  room.viewers = viewers;
  rooms.push(room);
}
console.error(`joined ${joins.length} viewers in ${rooms.length} rooms`);

const started = performance.now();
let tick = 0;
while (performance.now() - started < SECONDS * 1000) {
  tick += 1;
  const tickStarted = performance.now();
  const tickMs = 1000 / RATE;
  // Real rooms act independently, so events spread across each interval.
  for (let batch = 0; batch < BATCHES; batch += 1) {
    for (let i = batch; i < rooms.length; i += BATCHES) {
      const room = rooms[i];
      room.sentAt.set(tick, performance.now());
      room.viewers[0].socket.send(JSON.stringify({
        t: 'seek',
        d: { item: room.item, pos: tick, ct: Date.now() },
      }));
      sent += 1;
    }
    await sleep(Math.max(0, tickStarted + ((batch + 1) * tickMs) / BATCHES - performance.now()));
  }
}
await sleep(3000);

// Every member adds at once. The legacy server kept 2 of 100.
const race = rooms[0];
const addsPerMember = 8;
for (let i = 0; i < addsPerMember; i += 1) {
  for (const viewer of race.viewers) {
    viewer.socket.send(JSON.stringify({ t: 'queue.add', d: { url: `${MEDIA}?race=${i}-${Math.random()}` } }));
  }
}
await sleep(3000);
const doc = JSON.parse(await redis.hget(`room:${race.id}:state`, 'doc'));
const stored = doc.queue.length - 1; // The first item was already playing.

console.log(JSON.stringify({
  config: { nodes: NODES.length, rooms: ROOMS, members: MEMBERS, ratePerRoom: RATE, seconds: SECONDS },
  joinMs: summary(joins),
  propagationMs: summary(propagation),
  delivery: { sent, expected: sent * (MEMBERS - 1), received },
  closedSockets: closed,
  queueRace: { expectedAdds: addsPerMember * MEMBERS, survived: stored },
}, null, 1));

for (const room of rooms) for (const viewer of room.viewers) viewer.socket.close();
await redis.quit();
