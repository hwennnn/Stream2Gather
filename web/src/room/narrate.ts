import type { Person } from '../api/http';
import { expectedPosition, type Playback } from '../sync/controller';
import { formatTime } from '../ui/format';
import type { RoomView, StateMessage } from './session';

/** One person dragging the scrubber is one line in the chat. */
const SEEK_COLLAPSE_MS = 3000;
/** A reload shows as leaving and joining; within this it shows as nothing. */
const REJOIN_QUIET_MS = 10_000;
/** A pause that ends this soon was part of something else: a seek, or the video ending. */
const PAUSE_PAIR_MS = 2000;
/** Viewers report positions a little apart, so only more than this is a real move. */
const MOVE_SECONDS = 1.5;

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
  private pauses: { by: string; lineId: string; pos: number; at: number }[] = [];

  constructor(private readonly lines: Lines) {}

  /** A run of seeks ends with the video, or with the connection it was seen on. */
  endSeekRun(): void {
    this.seekRun = null;
  }

  stateChanged(message: StateMessage, previous: RoomView): void {
    const { by, cause, playback } = message;
    if (playback.item !== previous.playback.item) this.takeBackPauses();
    if (by && cause === 'pause') this.pause(by, playback.pos, previous);
    if (by && cause === 'play') this.resume(by, playback.pos, previous.playback);
    if (by && cause === 'seek') this.seek(by, playback.pos, previous.playback);
    this.lock(message, previous);
    if (cause === 'queue.add') {
      const existing = new Set(previous.queue.map((item) => item.id));
      const added = message.queue?.find((item) => !existing.has(item.id));
      if (by && added) this.lines.say(`${by} added ${added.title}`);
      return;
    }
    const current = message.queue?.[0];
    if (!current || playback.item === previous.playback.item) return;
    if (by && cause === 'queue.play') this.lines.say(`${by} jumped to ${current.title}`);
    else if (by && cause === 'queue.undo') this.lines.say(`${by} went back to ${current.title}`);
    else this.lines.say(`Up next: ${current.title}`);
  }

  /** Only the host's own toggle has an author. The server announces its own handovers. */
  private lock({ by, cause, settings }: StateMessage, previous: RoomView): void {
    if (cause !== 'settings' || !by || !settings) return;
    if (settings.controlMode === previous.settings.controlMode) return;
    this.lines.say(`${by} turned ${settings.controlMode === 'hosts' ? 'on' : 'off'} host controls`);
  }

  private pause(by: string, pos: number, { playback, queue }: RoomView): void {
    const durationMs = queue[0]?.durationMs ?? 0;
    if (durationMs > 0 && pos >= durationMs / 1000 - MOVE_SECONDS) return; // The video ran out.
    const now = this.lines.now();
    if (playback.status === 'playing' && Math.abs(pos - expectedPosition(playback, now)) > MOVE_SECONDS) {
      this.seek(by, pos, playback); // A player pauses on its way to a seek.
      return;
    }
    this.pauses.push({ by, lineId: this.lines.say(`${by} paused at ${formatTime(pos)}`), pos, at: now });
  }

  /** A pause that was over at once never happened. If the picture moved, that's the news. */
  private resume(by: string, pos: number, before: Playback): void {
    const now = this.lines.now();
    const pause = this.pauses.findLast((entry) => entry.by === by && now - entry.at < PAUSE_PAIR_MS);
    this.pauses = [];
    if (!pause) return;
    if (Math.abs(pos - pause.pos) <= MOVE_SECONDS) this.lines.remove(pause.lineId);
    else this.lines.rewrite(pause.lineId, `${by} ${pos < before.pos ? 'went back to' : 'jumped to'} ${formatTime(pos)}`);
  }

  /** The player pauses itself as a video ends, and nobody did that. */
  private takeBackPauses(): void {
    const now = this.lines.now();
    for (const pause of this.pauses) {
      if (now - pause.at < PAUSE_PAIR_MS) this.lines.remove(pause.lineId);
    }
    this.pauses = [];
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
