type Sample = { name: string; value: number; room?: string; source?: string; detail?: string };

const FLUSH_MS = 10_000;
let queue: Sample[] = [];

const flush = () => {
  if (queue.length === 0) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  navigator.sendBeacon('/v1/telemetry', new Blob([body], { type: 'application/json' }));
};

if (typeof window !== 'undefined') {
  window.setInterval(flush, FLUSH_MS);
  window.addEventListener('pagehide', flush);
}

export const track = (sample: Sample): void => {
  queue.push(sample);
};
