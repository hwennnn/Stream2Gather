import type { Person } from '../api/http';
import { expectedPosition, type Playback } from '../sync/controller';
import { formatTime } from '../ui/format';
import type { RoomView, StateMessage } from './session';

/** One person dragging the scrubber is one line in the chat. */
const SEEK_COLLAPSE_MS = 3000;
/** A reload shows as leaving and joining; within this it shows as nothing. */
const REJOIN_QUIET_MS = 10_000;

/** The chat as the narrator sees it. */
type Lines = {
  say(text: string): string;
  rewrite(lineId: string, text: string): boolean;
  remove(lineId: string): void;
  now(): number;
};

/** Writes what just happened in the room into the chat. */
export class Narrator {
  private seekRun: { by: string; lineId: string; from: number; at: number } | null = null;
  private recentlyLeft = new Map<string, { lineId: string; at: number }>();

  constructor(private readonly lines: Lines) {}

  /** A run of seeks ends with the video, or with the connection it was seen on. */
  endSeekRun(): void {
    this.seekRun = null;
  }

  stateChanged(message: StateMessage, previous: RoomView): void {
    const { by, cause, playback } = message;
    if (by && cause === 'pause') this.lines.say(`${by} paused at ${formatTime(playback.pos)}`);
    if (by && cause === 'seek') this.seek(by, playback.pos, previous.playback);
    this.lock(message, previous);
    if (cause === 'queue.add') {
      const existing = new Set(previous.queue.map((item) => item.id));
      const added = message.queue?.find((item) => !existing.has(item.id));
      if (by && added) this.lines.say(`${by} added ${added.title}`);
      return;
    }
    const current = message.queue?.[0];
    if (current && playback.item !== previous.playback.item) this.lines.say(`Up next: ${current.title}`);
  }

  /** Only the host's own toggle has an author. The server opens and relocks the rest. */
  private lock({ by, cause, settings }: StateMessage, previous: RoomView): void {
    if (cause === 'settings.release') this.lines.say('Host controls are off until the host is back');
    if (cause === 'settings.restore') this.lines.say('Host controls are back on');
    if (cause !== 'settings' || !by || !settings) return;
    if (settings.controlMode === previous.settings.controlMode) return;
    this.lines.say(`${by} turned ${settings.controlMode === 'hosts' ? 'on' : 'off'} host controls`);
  }

  private seek(by: string, to: number, before: Playback): void {
    const now = this.lines.now();
    const run = this.seekRun?.by === by && now - this.seekRun.at < SEEK_COLLAPSE_MS ? this.seekRun : null;
    const from = run?.from ?? expectedPosition(before, now);
    const text = `${by} ${to < from ? 'went back to' : 'jumped to'} ${formatTime(to)}`;
    if (run && this.lines.rewrite(run.lineId, text)) {
      run.at = now;
      return;
    }
    this.seekRun = { by, lineId: this.lines.say(text), from, at: now };
  }

  membersChanged(before: Person[], members: Person[], selfId: string | undefined): void {
    const now = Date.now();
    for (const person of members) {
      if (person.userId === selfId || before.some((other) => other.userId === person.userId)) continue;
      const left = this.recentlyLeft.get(person.userId);
      this.recentlyLeft.delete(person.userId);
      if (left && now - left.at < REJOIN_QUIET_MS) this.lines.remove(left.lineId);
      else this.lines.say(`${person.name} joined`);
    }
    for (const person of before) {
      if (person.userId === selfId || members.some((other) => other.userId === person.userId)) continue;
      this.recentlyLeft.set(person.userId, { lineId: this.lines.say(`${person.name} left`), at: now });
    }
  }
}
