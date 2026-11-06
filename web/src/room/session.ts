import { api, ApiError, type ChatMessage, type Media, type Person } from '../api/http';
import { ServerClock } from '../sync/clock';
import { expectedPosition, type Playback, type SyncHealth } from '../sync/controller';
import { formatTime } from '../ui/format';

export type QueueItem = Media & { id: string; addedBy: string; addedByName: string };

export type Settings = { controlMode: 'everyone' | 'hosts'; queueMode: 'everyone' | 'hosts' };

export type ChatEntry =
  | (ChatMessage & { kind: 'chat' })
  | { kind: 'system'; id: string; text: string; createdAt: string };

export type QueueMode = 'now' | 'next' | 'end';

type Reaction = { id: number; emoji: string; name: string };

type Notice = { id: number; text: string; url?: string };

export type RoomView = {
  connection: 'connecting' | 'live' | 'reconnecting' | 'failed';
  failure: string | null;
  /** When the connection dropped, in local milliseconds. Null while connected. */
  offlineSince: number | null;
  self: Person | null;
  name: string;
  version: number;
  playback: Playback;
  queue: QueueItem[];
  settings: Settings;
  members: Person[];
  /** True when nobody else is in the room. */
  alone: boolean;
  viewerStates: Record<string, string>;
  messages: ChatEntry[];
  reactions: Reaction[];
  notices: Notice[];
  lastAction: { by: string; cause: string } | null;
};

type StateMessage = {
  version: number;
  playback: Playback;
  queue?: QueueItem[];
  settings?: Settings;
  cause: string;
  by?: string;
};

type Pending = { resolve: () => void; reject: (error: Error) => void; timer: number };

const initialView: RoomView = {
  connection: 'connecting',
  failure: null,
  offlineSince: null,
  self: null,
  name: '',
  version: 0,
  playback: { item: '', status: 'idle', pos: 0, at: 0, rate: 1 },
  queue: [],
  settings: { controlMode: 'everyone', queueMode: 'everyone' },
  members: [],
  alone: false,
  viewerStates: {},
  messages: [],
  reactions: [],
  notices: [],
  lastAction: null,
};

const MAX_BACKOFF_MS = 5000;
const REACTION_LIFE_MS = 2600;
const NOTICE_LIFE_MS = 8000;
const MAX_ENTRIES = 300;
const PING_EVERY_MS = 10_000;
/** A dead network can take minutes to fire onclose, so silence counts as closed. */
const MAX_UNANSWERED_PINGS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
/** How long a requested snapshot may take before pongs may force a reconnect. */
const RESYNC_WAIT_MS = 5000;
/** One person dragging the scrubber is one line in the chat. */
const SEEK_COLLAPSE_MS = 3000;
/** A reload shows as leaving and joining; within this it shows as nothing. */
const REJOIN_QUIET_MS = 10_000;

const OFFLINE_COPY = 'You’re offline right now. Try again once you’re back.';
const LOST_COPY = 'The connection dropped before that went through. Try again.';
const TIMEOUT_COPY = 'That took too long. Try again.';

const copyFor = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong. Try again.';

/** Owns the connection to one room and everything the UI reads about it. */
export class RoomSession {
  readonly clock = new ServerClock();
  private view = initialView;
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private playbackListener: (playback: Playback) => void = () => {};
  private pinger: number | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  /** Bumped by every connect and close, so an older attempt can tell it lost. */
  private generation = 0;
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private unanswered = 0;
  private joinStartedAt = performance.now();
  private lastStatus = '';
  private behindAt: number | null = null;
  private resyncAt: number | null = null;
  private seekRun: { by: string; lineId: string; from: number; at: number } | null = null;
  private recentlyLeft = new Map<string, { lineId: string; at: number }>();
  readonly marks: { joinMs?: number } = {};

  constructor(private readonly slug: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  private update(patch: Partial<RoomView>): void {
    const next = { ...this.view, ...patch };
    const selfId = next.self?.userId;
    next.alone = selfId !== undefined && next.members.every((person) => person.userId === selfId);
    this.view = next;
    for (const listener of this.listeners) listener();
  }

  onPlayback(listener: (playback: Playback) => void): void {
    this.playbackListener = listener;
  }

  async connect(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.clearReconnect();
    try {
      const { ticket } = await api.ticket(this.slug);
      if (generation !== this.generation) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${scheme}://${window.location.host}/v1/ws?ticket=${ticket}`);
      this.socket = socket;
      socket.onopen = () => this.startClock();
      socket.onmessage = (event) => this.receive(String(event.data));
      socket.onclose = () => this.handleClose();
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        this.update({ connection: 'failed', failure: error.message });
        return;
      }
      this.handleClose();
    }
  }

  private handleClose(): void {
    this.detachSocket();
    this.update({ connection: 'reconnecting', offlineSince: this.view.offlineSince ?? Date.now() });
    this.attempts += 1;
    const backoff = Math.min(250 * 2 ** this.attempts, MAX_BACKOFF_MS);
    this.reconnectTimer = window.setTimeout(() => void this.connect(), backoff * (0.5 + Math.random() / 2));
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** Forgets the socket, so nothing it does later can reach this session. */
  private detachSocket(): WebSocket | null {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
    }
    this.stopClock();
    for (const [id, request] of this.pending) this.settle(id, request, new Error(LOST_COPY));
    return socket;
  }

  private startClock(): void {
    // The opening burst tunes the clock. It is not counted, because a slow link
    // sends all of it before the first answer can arrive.
    for (let i = 0; i < 5; i += 1) window.setTimeout(() => this.ping(), i * 120);
    this.unanswered = 0;
    this.pinger = window.setInterval(() => this.heartbeat(), PING_EVERY_MS);
  }

  private stopClock(): void {
    if (this.pinger !== null) window.clearInterval(this.pinger);
    this.pinger = null;
  }

  private heartbeat(): void {
    if (this.unanswered >= MAX_UNANSWERED_PINGS) {
      this.dropSocket();
      this.handleClose();
      return;
    }
    this.unanswered += 1;
    this.ping();
  }

  private dropSocket(): void {
    this.detachSocket()?.close();
  }

  private ping(): void {
    this.send('ping', { t0: Date.now() });
  }

  /** Sends without waiting for an answer. False when the socket is not open. */
  send(type: string, data?: unknown): boolean {
    return this.transmit({ t: type, d: data });
  }

  private transmit(message: { t: string; id?: string; d?: unknown }): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Resolves on the server's ack. Rejects with copy the UI can show as it is. */
  request(type: string, data?: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = `r${this.nextId++}`;
      if (!this.transmit({ t: type, id, d: data })) {
        reject(new Error(OFFLINE_COPY));
        return;
      }
      const timer = window.setTimeout(() => {
        const request = this.pending.get(id);
        if (request) this.settle(id, request, new Error(TIMEOUT_COPY));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private settle(id: string, request: Pending, error?: Error): void {
    this.pending.delete(id);
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve();
  }

  queueAdd(input: { url?: string; media?: Media }, mode: QueueMode): Promise<void> {
    return this.request('queue.add', { url: input.url ?? input.media?.url ?? '', mode });
  }

  queueMove(target: string, index: number): Promise<void> {
    return this.request('queue.move', { target, index });
  }

  queueRemove(target: string): Promise<void> {
    return this.request('queue.remove', { target });
  }

  /** Saves the name to the cookie, then renames this viewer in the room. */
  async rename(name: string): Promise<void> {
    let saved: string;
    try {
      const { user } = await api.rename(name);
      saved = user?.name ?? name.trim();
    } catch (error) {
      throw new Error(copyFor(error));
    }
    if (this.view.self) this.update({ self: { ...this.view.self, name: saved } });
    // The name is safe in the cookie. A socket that cannot take it will pick it
    // up from the next ticket, so this is not a failure the viewer can act on.
    if (this.socket) await this.request('rename', { name: saved }).catch(() => this.rejoin());
  }

  private receive(raw: string): void {
    const { t, d } = JSON.parse(raw) as { t: string; d: never };
    switch (t) {
      case 'welcome':
        this.welcome(d);
        break;
      case 'pong':
        this.pong(d);
        break;
      case 'ack':
        this.acknowledged(d);
        break;
      case 'playback':
      case 'state':
        this.stateChanged(d);
        break;
      case 'members':
        this.membersChanged((d as { members: Person[] }).members);
        break;
      case 'member.status':
        this.memberStatus(d);
        break;
      case 'member.rename':
        this.memberRenamed(d);
        break;
      case 'chat':
        this.chat(d);
        break;
      case 'react':
        this.reaction(d);
        break;
      case 'notice':
        this.notice(d);
        break;
      case 'error':
        this.failed(d);
        break;
    }
  }

  private acknowledged(data: { id: string }): void {
    const request = this.pending.get(data.id);
    if (request) this.settle(data.id, request);
  }

  private failed(data: { re?: string; message: string }): void {
    const request = data.re ? this.pending.get(data.re) : undefined;
    if (request && data.re) this.settle(data.re, request, new Error(data.message));
    else this.notice({ text: data.message });
  }

  private welcome(data: {
    self: Person;
    room: { name: string };
    state: { version: number; playback: Playback; queue: QueueItem[]; settings: Settings };
    members: Person[];
  }): void {
    this.attempts = 0;
    this.behindAt = null;
    this.resyncAt = null;
    this.seekRun = null;
    this.lastStatus = '';
    this.marks.joinMs ??= performance.now() - this.joinStartedAt;
    this.update({
      connection: 'live',
      failure: null,
      offlineSince: null,
      self: data.self,
      name: data.room.name,
      version: data.state.version,
      playback: data.state.playback,
      queue: data.state.queue ?? [],
      settings: data.state.settings,
      members: data.members ?? [],
      viewerStates: {},
    });
    this.playbackListener(data.state.playback);
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const generation = this.generation;
    try {
      const { items } = await api.messages(this.slug);
      if (generation === this.generation) this.mergeHistory(items);
    } catch {
      // Chat history is a nicety. The room works without it.
    }
  }

  private mergeHistory(items: ChatMessage[]): void {
    const known = new Set(this.view.messages.map((entry) => entry.id));
    const missing = items
      .filter((message) => !known.has(message.id))
      .map((message): ChatEntry => ({ ...message, kind: 'chat' }));
    if (missing.length === 0) return;
    const merged = [...missing, ...this.view.messages].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    this.update({ messages: merged.slice(-MAX_ENTRIES) });
  }

  private pong(data: { t0: number; ts: number; version?: number }): void {
    this.unanswered = 0;
    this.clock.addSample(data.t0, data.ts, Date.now());
    if (this.view.connection !== 'live' || data.version === undefined) return;
    if (this.resyncAt !== null && Date.now() - this.resyncAt < RESYNC_WAIT_MS) return;
    // Events can be in flight behind one pong, so only a mismatch that survives
    // to the next pong counts. A lower version means Redis went backwards.
    const mismatch = data.version !== this.view.version;
    if (mismatch && this.behindAt === this.view.version) {
      this.behindAt = null;
      this.socket?.close();
      return;
    }
    this.behindAt = mismatch ? this.view.version : null;
  }

  private requestResync(): void {
    if (this.resyncAt !== null && Date.now() - this.resyncAt < RESYNC_WAIT_MS) return;
    this.behindAt = null;
    this.resyncAt = Date.now();
    this.send('sync');
  }

  private stateChanged(message: StateMessage): void {
    if (this.view.connection !== 'live') return;
    const snapshot = message.cause === 'sync';
    if (!snapshot) {
      if (message.version <= this.view.version) return;
      if (message.version > this.view.version + 1) {
        // Jumping forward would keep a queue that missed its update.
        this.requestResync();
        return;
      }
    }
    this.resyncAt = snapshot ? null : this.resyncAt;

    const previous = this.view;
    const itemChanged = message.playback.item !== previous.playback.item;
    if (itemChanged) {
      this.lastStatus = '';
      this.seekRun = null;
    }
    this.update({
      version: message.version,
      playback: message.playback,
      queue: message.queue ?? previous.queue,
      settings: message.settings ?? previous.settings,
      lastAction: message.by ? { by: message.by, cause: message.cause } : previous.lastAction,
      viewerStates: itemChanged ? {} : previous.viewerStates,
    });
    if (!snapshot) this.narrate(message, previous);
    this.playbackListener(message.playback);
  }

  /** Writes what just happened into the chat. */
  private narrate(message: StateMessage, previous: RoomView): void {
    const { by, cause, playback } = message;
    if (by && cause === 'pause') this.say(`${by} paused at ${formatTime(playback.pos)}`);
    if (by && cause === 'seek') this.narrateSeek(by, playback.pos, previous.playback);
    if (cause === 'queue.add') {
      const existing = new Set(previous.queue.map((item) => item.id));
      const added = message.queue?.find((item) => !existing.has(item.id));
      if (by && added) this.say(`${by} added ${added.title}`);
      return;
    }
    const current = message.queue?.[0];
    if (current && playback.item !== previous.playback.item) this.say(`Up next: ${current.title}`);
  }

  private narrateSeek(by: string, to: number, before: Playback): void {
    const now = this.clock.now();
    const run = this.seekRun?.by === by && now - this.seekRun.at < SEEK_COLLAPSE_MS ? this.seekRun : null;
    const from = run?.from ?? expectedPosition(before, now);
    const text = `${by} ${to < from ? 'went back to' : 'jumped to'} ${formatTime(to)}`;
    if (run && this.rewrite(run.lineId, text)) {
      run.at = now;
      return;
    }
    this.seekRun = { by, lineId: this.say(text), from, at: now };
  }

  private rewrite(lineId: string, text: string): boolean {
    const found = this.view.messages.some((entry) => entry.id === lineId);
    if (found) {
      this.update({
        messages: this.view.messages.map((entry) => (entry.id === lineId ? { ...entry, text } : entry)),
      });
    }
    return found;
  }

  private say(text: string): string {
    const id = `s${this.nextId++}`;
    const createdAt = new Date(this.clock.now()).toISOString();
    this.append({ kind: 'system', id, text, createdAt });
    return id;
  }

  private append(entry: ChatEntry): void {
    this.update({ messages: [...this.view.messages, entry].slice(-MAX_ENTRIES) });
  }

  private membersChanged(members: Person[]): void {
    const before = this.view.members;
    this.update({ members });
    if (this.view.connection !== 'live') return;

    const selfId = this.view.self?.userId;
    const now = Date.now();
    for (const person of members) {
      if (person.userId === selfId || before.some((other) => other.userId === person.userId)) continue;
      const left = this.recentlyLeft.get(person.userId);
      this.recentlyLeft.delete(person.userId);
      if (left && now - left.at < REJOIN_QUIET_MS) {
        this.update({ messages: this.view.messages.filter((entry) => entry.id !== left.lineId) });
      } else {
        this.say(`${person.name} joined`);
      }
    }
    for (const person of before) {
      if (person.userId === selfId || members.some((other) => other.userId === person.userId)) continue;
      this.recentlyLeft.set(person.userId, { lineId: this.say(`${person.name} left`), at: now });
    }
  }

  private memberStatus(data: { userId: string; state: string; item?: string }): void {
    if (data.item && data.item !== this.view.playback.item) return;
    // A viewer who cannot play this video keeps reporting health from a player
    // that is not showing anything.
    if (this.view.viewerStates[data.userId] === 'unavailable') return;
    this.update({ viewerStates: { ...this.view.viewerStates, [data.userId]: data.state } });
  }

  /** Another tab of this person changed their name. */
  private memberRenamed(data: { userId: string; name: string }): void {
    const self = this.view.self;
    if (self?.userId === data.userId && self.name !== data.name) {
      this.update({ self: { ...self, name: data.name } });
    }
  }

  private chat(data: { message: ChatMessage }): void {
    if (this.view.messages.some((entry) => entry.id === data.message.id)) return;
    this.append({ ...data.message, kind: 'chat' });
  }

  private reaction(data: { emoji: string; name: string }): void {
    const id = this.nextId++;
    this.update({ reactions: [...this.view.reactions, { id, ...data }] });
    window.setTimeout(
      () => this.update({ reactions: this.view.reactions.filter((reaction) => reaction.id !== id) }),
      REACTION_LIFE_MS,
    );
  }

  private notice(data: { text: string; url?: string }): void {
    const id = this.nextId++;
    this.update({ notices: [...this.view.notices, { id, ...data }] });
    window.setTimeout(
      () => this.update({ notices: this.view.notices.filter((notice) => notice.id !== id) }),
      NOTICE_LIFE_MS,
    );
  }

  /** Shares this viewer's sync health when its category changes. */
  reportStatus(health: SyncHealth, drift: number): void {
    if (health === this.lastStatus) return;
    const selfId = this.view.self?.userId;
    if (selfId && this.view.viewerStates[selfId] === 'unavailable') return;
    if (this.send('status', { state: health, drift: Math.round(drift * 1000) / 1000 })) {
      this.lastStatus = health;
    }
  }

  /** Reconnects now, without waiting out the backoff. */
  retry(): void {
    this.clearReconnect();
    this.attempts = 0;
    this.dropSocket();
    this.update({ connection: 'reconnecting', offlineSince: this.view.offlineSince ?? Date.now() });
    void this.connect();
  }

  /** A new socket carries the new identity; the room state comes back with it. */
  rejoin(): void {
    this.retry();
  }

  close(): void {
    this.generation += 1;
    this.clearReconnect();
    this.dropSocket();
  }
}
