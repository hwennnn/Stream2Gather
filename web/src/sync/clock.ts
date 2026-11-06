/** One round trip to the server, in local milliseconds. */
export type ClockSample = { offset: number; rtt: number };

const KEPT_SAMPLES = 8;

/**
 * Estimates server time. The sample with the lowest round trip is the one least
 * distorted by queueing, so it wins over an average.
 */
export class ServerClock {
  private samples: ClockSample[] = [];

  constructor(private readonly localNow: () => number = () => Date.now()) {}

  /** Records a ping sent at t0 and answered with server time ts, received at t1. */
  addSample(t0: number, ts: number, t1: number): void {
    const rtt = t1 - t0;
    this.samples.push({ offset: ts + rtt / 2 - t1, rtt });
    if (this.samples.length > KEPT_SAMPLES) this.samples.shift();
  }

  get offset(): number {
    let best: ClockSample | undefined;
    for (const sample of this.samples) {
      if (!best || sample.rtt < best.rtt) best = sample;
    }
    return best?.offset ?? 0;
  }

  get rtt(): number {
    return Math.min(...this.samples.map((sample) => sample.rtt), Infinity);
  }

  now(): number {
    return this.localNow() + this.offset;
  }
}
