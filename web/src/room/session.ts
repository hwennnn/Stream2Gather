import { api, ApiError, type ChatMessage, type Media, type Person } from '../api/http';
import { ServerClock } from '../sync/clock';
import type { Playback, SyncHealth } from '../sync/controller';

export type QueueItem = Media & { id: string; addedBy: string; addedByName: string };

export type Settings = { controlMode: 'everyone' | 'hosts'; queueMode: 'everyone' | 'hosts' };

type Reaction = { id: number; emoji: string; name: string };

type Notice = { id: number; text: string; url?: string };

export type RoomView = {
  connection: 'connecting' | 'live' | 'reconnecting' | 'failed';
  failure: string | null;
  self: Person | null;
  name: string;
  version: number;
  playback: Playback;
  queue: QueueItem[];
  settings: Settings;
  members: Person[];
  viewerStates: Record<string, string>;
  messages: ChatMessage[];
  reactions: Reaction[];
  notices: Notice[];
  activity: string | null;
};

type StateMessage = {
  version: number;
  playback: Playback;
  queue?: QueueItem[];
  settings?: Settings;
  cause: string;
  by?: string;
};

const initialView: RoomView = {
  connection: 'connecting',
  failure: null,
  self: null,
  name: '',
  version: 0,
  playback: { item: '', status: 'idle', pos: 0, at: 0, rate: 1 },
  queue: [],
  settings: { controlMode: 'everyone', queueMode: 'everyone' },
  members: [],
  viewerStates: {},
  messages: [],
  reactions: [],
  notices: [],
  activity: null,
};

const describe = (message: StateMessage): string | null => {
  if (!message.by) return null;
  const verbs: Record<string, string> = {
    play: 'pressed play',
    pause: 'paused',
    seek: 'jumped ahead',
    skip: 'skipped',
    'queue.add': 'added a video',
    'queue.play': 'changed the video',
    'queue.remove': 'removed a video',
  };
  const verb = verbs[message.cause];
  return verb ? `${message.by} ${verb}` : null;
};

const MAX_BACKOFF_MS = 5000;
const REACTION_LIFE_MS = 2600;
const NOTICE_LIFE_MS = 8000;

/** Owns the connection to one room and everything the UI reads about it. */
export class RoomSession {
  readonly clock = new ServerClock();
  private view = initialView;
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private playbackListener: (playback: Playback) => void = () => {};
  private pinger: number | null = null;
  private attempts = 0;
  private closed = false;
  private nextId = 1;
  private joinStartedAt = performance.now();
  private lastStatus = '';
  readonly marks: { joinMs?: number } = {};

  constructor(private readonly slug: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  private update(patch: Partial<RoomView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }

  onPlayback(listener: (playback: Playback) => void): void {
    this.playbackListener = listener;
  }

  async connect(): Promise<void> {
    if (this.closed) return;
    try {
      const { ticket } = await api.ticket(this.slug);
      if (this.closed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${scheme}://${window.location.host}/v1/ws?ticket=${ticket}`);
      this.socket = socket;
      socket.onopen = () => this.startClock();
      socket.onmessage = (event) => this.receive(String(event.data));
      socket.onclose = () => this.handleClose();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        this.update({ connection: 'failed', failure: error.message });
        return;
      }
      this.handleClose();
    }
  }

  private handleClose(): void {
    this.stopClock();
    if (this.closed) return;
    this.update({ connection: 'reconnecting' });
    this.attempts += 1;
    const backoff = Math.min(250 * 2 ** this.attempts, MAX_BACKOFF_MS);
    window.setTimeout(() => void this.connect(), backoff * (0.5 + Math.random() / 2));
  }

  private startClock(): void {
    for (let i = 0; i < 5; i += 1) window.setTimeout(() => this.ping(), i * 120);
    this.pinger = window.setInterval(() => this.ping(), 10_000);
  }

  private stopClock(): void {
    if (this.pinger !== null) window.clearInterval(this.pinger);
    this.pinger = null;
  }

  private ping(): void {
    this.send('ping', { t0: Date.now() });
  }

  send(type: string, data?: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ t: type, d: data }));
    }
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
      case 'playback':
      case 'state':
        this.stateChanged(d);
        break;
      case 'members':
        this.update({ members: (d as { members: Person[] }).members });
        break;
      case 'member.status':
        this.memberStatus(d);
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
        this.notice({ text: (d as { message: string }).message });
        break;
    }
  }

  private welcome(data: {
    self: Person;
    room: { name: string };
    state: { version: number; playback: Playback; queue: QueueItem[]; settings: Settings };
    members: Person[];
  }): void {
    this.attempts = 0;
    this.marks.joinMs ??= performance.now() - this.joinStartedAt;
    this.update({
      connection: 'live',
      failure: null,
      self: data.self,
      name: data.room.name,
      version: data.state.version,
      playback: data.state.playback,
      queue: data.state.queue ?? [],
      settings: data.state.settings,
      members: data.members ?? [],
    });
    this.playbackListener(data.state.playback);
    void api.messages(this.slug).then(({ items }) => this.update({ messages: [...items].reverse() }));
  }

  private pong(data: { t0: number; ts: number; version: number }): void {
    this.clock.addSample(data.t0, data.ts, Date.now());
    // A missed event shows up here; reconnecting returns a fresh snapshot.
    if (data.version > this.view.version + 1) this.socket?.close();
  }

  private stateChanged(message: StateMessage): void {
    if (message.version < this.view.version) return;
    this.update({
      version: message.version,
      playback: message.playback,
      queue: message.queue ?? this.view.queue,
      settings: message.settings ?? this.view.settings,
      activity: describe(message) ?? this.view.activity,
    });
    this.playbackListener(message.playback);
  }

  private memberStatus(data: { userId: string; state: string }): void {
    this.update({ viewerStates: { ...this.view.viewerStates, [data.userId]: data.state } });
  }

  private chat(data: { message: ChatMessage }): void {
    this.update({ messages: [...this.view.messages, data.message].slice(-300) });
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
    this.lastStatus = health;
    this.send('status', { state: health, drift: Math.round(drift * 1000) / 1000 });
  }

  close(): void {
    this.closed = true;
    this.stopClock();
    this.socket?.close();
  }
}
