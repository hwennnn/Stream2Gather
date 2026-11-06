import { api, ApiError, type ChatMessage, type Media, type Person } from '../api/http';
import { ServerClock } from '../sync/clock';
import type { Playback, SyncHealth } from '../sync/controller';
import { Narrator } from './narrate';

export type QueueItem = Media & { id: string; addedBy: string; addedByName: string };

export type Settings = { controlMode: 'everyone' | 'hosts'; queueMode: 'everyone' | 'hosts' };

export type ChatLine = Omit<ChatMessage, 'id'> & {
  kind: 'chat';
  /** A string until proven otherwise: this viewer's own line, shown before the server has it. */
  id: number | string;
  /** History is what was said before this viewer joined, so none of it is news. */
  history?: true;
  /** How far this viewer's own line has got. Unset once the server has it. */
  delivery?: 'sending' | 'failed';
  /** The server's id for an own line. The local id stays, so unread and scrolling see one line. */
  serverId?: number;
};

export type ChatEntry = ChatLine | { kind: 'system'; id: string; text: string; createdAt: string };

/** Limited means the server refused it for speed, so the text is still worth keeping. */
export type ChatResult = { id: string; limited: boolean };

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

export type StateMessage = {
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
const PING_EVERY_MS = 3000;
/** Only every third ping samples the clock and compares versions, so both keep their pace. */
const CHECK_EVERY_PINGS = 3;
/** A dead network can take minutes to fire onclose, so silence counts as closed. */
const SILENCE_LIMIT_MS = 8000;
const REQUEST_TIMEOUT_MS = 15_000;
/** How long a chat line stays dimmed before it says it wasn't sent. */
const SEND_PATIENCE_MS = 5000;
/** The server stamps a line a moment after this viewer's estimate of the same time. */
const STAMP_SLACK_MS = 2000;
/** How long a requested snapshot may take before pongs may force a reconnect. */
const RESYNC_WAIT_MS = 5000;
const OFFLINE_COPY = 'You’re offline right now. Try again once you’re back.';
const LOST_COPY = 'The connection dropped before that went through. Try again.';
const TIMEOUT_COPY = 'That took too long. Try again.';

const copyFor = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong. Try again.';

/** A refusal from the server, with the copy to show and the code to act on. */
class Refused extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const serverIdOf = (entry: ChatEntry) => (entry.kind === 'chat' ? (entry.serverId ?? entry.id) : entry.id);

/** Settles the viewer's own waiting line with the message the server made of it. */
const confirmOwn = (entries: ChatEntry[], message: ChatMessage): ChatEntry[] | null => {
  const sentAt = Date.parse(message.createdAt);
  const own = entries.find(
    (entry) =>
      entry.kind === 'chat' &&
      typeof entry.id === 'string' &&
      entry.serverId === undefined &&
      entry.userId === message.userId &&
      entry.body === message.body &&
      sentAt >= Date.parse(entry.createdAt) - STAMP_SLACK_MS,
  );
  if (!own) return null;
  const settled = { ...own, serverId: message.id, createdAt: message.createdAt, delivery: undefined };
  return entries.map((entry) => (entry === own ? settled : entry));
};

/** Owns the connection to one room and everything the UI reads about it. */
export class RoomSession {
  readonly clock = new ServerClock();
  private view = initialView;
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private playbackListener: (playback: Playback, resync: boolean) => void = () => {};
  private pinger: number | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  /** Bumped by every connect and close, so an older attempt can tell it lost. */
  private generation = 0;
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private beats = 0;
  private lastBeat = 0;
  private lastHeard = 0;
  private joinStartedAt = performance.now();
  private lastStatus = '';
  private behindAt: number | null = null;
  private resyncAt: number | null = null;
  private historyLoaded = false;
  private narrator = new Narrator({
    say: (text) => this.say(text),
    rewrite: (lineId, text) => this.rewrite(lineId, text),
    remove: (lineId) => this.update({ messages: this.view.messages.filter((entry) => entry.id !== lineId) }),
    now: () => this.clock.now(),
  });
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

  /** Resync is true when the room is insisting, not reporting a change. */
  onPlayback(listener: (playback: Playback, resync: boolean) => void): void {
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
    // The opening burst tunes the clock.
    for (let i = 0; i < 5; i += 1) window.setTimeout(() => this.ping(), i * 120);
    this.lastBeat = Date.now();
    this.lastHeard = this.lastBeat;
    this.pinger = window.setInterval(() => this.heartbeat(), PING_EVERY_MS);
  }

  private stopClock(): void {
    if (this.pinger !== null) window.clearInterval(this.pinger);
    this.pinger = null;
  }

  private heartbeat(): void {
    const now = Date.now();
    // A background tab's timers run late, and then the silence proves nothing.
    if (now - this.lastBeat > PING_EVERY_MS * 2) this.lastHeard = now;
    this.lastBeat = now;
    if (now - this.lastHeard >= SILENCE_LIMIT_MS) {
      this.dropSocket();
      this.handleClose();
      return;
    }
    this.beats += 1;
    if (this.beats % CHECK_EVERY_PINGS === 0) this.ping();
    else this.send('ping');
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
  request(type: string, data?: unknown, patience = REQUEST_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = `r${this.nextId++}`;
      if (!this.transmit({ t: type, id, d: data })) {
        reject(new Error(OFFLINE_COPY));
        return;
      }
      const timer = window.setTimeout(() => {
        const request = this.pending.get(id);
        if (request) this.settle(id, request, new Error(TIMEOUT_COPY));
      }, patience);
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
    if (this.socket) await this.request('rename', { name: saved }).catch(() => this.retry());
  }

  private receive(raw: string): void {
    this.lastHeard = Date.now();
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

  private failed(data: { re?: string; code?: string; message: string }): void {
    const request = data.re ? this.pending.get(data.re) : undefined;
    if (request && data.re) this.settle(data.re, request, new Refused(data.message, data.code));
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
    this.narrator.endSeekRun();
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
    this.playbackListener(data.state.playback, true);
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
    // What comes in on a reconnect was said while this viewer was in the room.
    const history = this.historyLoaded ? {} : { history: true as const };
    this.historyLoaded = true;
    // A line that seemed lost may have reached the server after all.
    const lines = items.reduce((entries, message) => confirmOwn(entries, message) ?? entries, this.view.messages);
    const known = new Set(lines.map(serverIdOf));
    const missing = items
      .filter((message) => !known.has(message.id))
      .map((message): ChatEntry => ({ ...message, kind: 'chat', ...history }));
    if (missing.length === 0 && lines === this.view.messages) return;
    const merged = [...missing, ...lines].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    this.update({ messages: merged.slice(-MAX_ENTRIES) });
  }

  private pong(data: { t0: number; ts: number; version?: number }): void {
    if (data.t0 === 0) return; // A ping that only asked whether anyone is there.
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
      this.narrator.endSeekRun();
    }
    this.update({
      version: message.version,
      playback: message.playback,
      queue: message.queue ?? previous.queue,
      settings: message.settings ?? previous.settings,
      lastAction: message.by ? { by: message.by, cause: message.cause } : previous.lastAction,
      viewerStates: itemChanged ? {} : previous.viewerStates,
    });
    if (!snapshot) this.narrator.stateChanged(message, previous);
    this.playbackListener(message.playback, snapshot);
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

    this.narrator.membersChanged(before, members, this.view.self?.userId);
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
    if (this.view.messages.some((entry) => serverIdOf(entry) === data.message.id)) return;
    const confirmed = confirmOwn(this.view.messages, data.message);
    if (confirmed) this.update({ messages: confirmed });
    else this.append({ ...data.message, kind: 'chat' });
  }

  /** Shows the line now, and settles it when the server answers. */
  async sendChat(body: string): Promise<ChatResult> {
    const id = `c${this.nextId++}`;
    const { userId = '', name: author = '' } = this.view.self ?? {};
    const createdAt = new Date(this.clock.now()).toISOString();
    this.append({ kind: 'chat', id, userId, author, body, createdAt, delivery: 'sending' });
    return { id, limited: await this.deliver(id, body) };
  }

  /** Sends a failed line again, from the end of the chat, where it will now land. */
  retryChat(id: string): void {
    const line = this.view.messages.find((entry) => entry.id === id);
    if (line?.kind !== 'chat') return;
    const createdAt = new Date(this.clock.now()).toISOString();
    this.update({
      messages: [...this.view.messages.filter((entry) => entry !== line), { ...line, createdAt, delivery: 'sending' }],
    });
    void this.deliver(id, line.body);
  }

  discardChat(id: string): void {
    this.update({ messages: this.view.messages.filter((entry) => entry.id !== id) });
  }

  /** True when the server refused the line for speed. */
  private async deliver(id: string, body: string): Promise<boolean> {
    try {
      await this.request('chat.send', { text: body }, SEND_PATIENCE_MS);
      this.markLine(id, undefined);
      return false;
    } catch (error) {
      this.markLine(id, 'failed');
      return error instanceof Refused && error.code === 'rate_limited';
    }
  }

  /** The echo can beat the answer, and a settled line stays settled. */
  private markLine(id: string, delivery: ChatLine['delivery']): void {
    const line = this.view.messages.find((entry) => entry.id === id);
    if (line?.kind !== 'chat' || line.serverId !== undefined) return;
    this.update({ messages: this.view.messages.map((entry) => (entry === line ? { ...line, delivery } : entry)) });
  }

  private reaction(data: { emoji: string; name: string }): void {
    const id = this.nextId++;
    this.update({ reactions: [...this.view.reactions, { id, ...data }] });
    window.setTimeout(
      () => this.update({ reactions: this.view.reactions.filter((reaction) => reaction.id !== id) }),
      REACTION_LIFE_MS,
    );
  }

  private notice(data: { kind?: string; text: string; url?: string }): void {
    // These change the room, so the chat keeps the same words the toast shows.
    if (data.kind === 'host' || data.kind === 'skipped') this.say(data.text);
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

  /** Reconnects now, without waiting out the backoff. A new socket also carries a new identity. */
  retry(): void {
    this.clearReconnect();
    this.attempts = 0;
    this.dropSocket();
    this.update({ connection: 'reconnecting', offlineSince: this.view.offlineSince ?? Date.now() });
    void this.connect();
  }

  close(): void {
    this.generation += 1;
    this.clearReconnect();
    this.dropSocket();
  }
}
