import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomSession, type ChatEntry, type QueueItem } from './session';

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  static opened = 0;
  readyState = FakeSocket.OPEN;
  closed = 0;
  sent: { t: string; id?: string; d?: Record<string, unknown> }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
    FakeSocket.opened += 1;
  }
  send(body: string) {
    this.sent.push(JSON.parse(body) as FakeSocket['sent'][number]);
  }
  close() {
    this.closed += 1;
  }
  deliver(t: string, d: unknown) {
    this.onmessage?.({ data: JSON.stringify({ t, d }) });
  }
  /** Answers the last message with an id, as the server would. */
  ack() {
    this.deliver('ack', { id: this.sent.at(-1)?.id });
  }
  ofType(t: string) {
    return this.sent.filter((message) => message.t === t);
  }
}

const welcome = (version: number) => ({
  self: { userId: 'g_1', name: 'Ada', role: 'member' },
  room: { name: 'Room' },
  state: {
    version,
    playback: { item: '', status: 'idle', pos: 0, at: 0, rate: 1 },
    queue: [],
    settings: { controlMode: 'everyone', queueMode: 'everyone' },
  },
  members: [],
});

const pong = (version: number) => ({ t0: 1, ts: 0, version });

const idle = { item: '', status: 'idle', pos: 0, at: 0, rate: 1 };

const person = (userId: string, name: string) => ({ userId, name, role: 'member' });
const ada = person('g_1', 'Ada');
const maya = person('g_2', 'Maya');
const sam = person('g_3', 'Sam');

const item = (id: string) =>
  ({ id, title: `Video ${id}`, url: '', source: 'direct', sourceId: id }) as unknown as QueueItem;

const chatLine = (id: number) => ({
  id,
  userId: 'g_2',
  author: 'Maya',
  body: `line ${id}`,
  createdAt: new Date(1_000_000 + id * 1000).toISOString(),
});

const playingWelcome = (current: string) => {
  const base = welcome(1);
  return { ...base, state: { ...base.state, playback: { ...idle, item: current }, queue: [item(current)] } };
};

const entries = (session: RoomSession): ChatEntry[] => session.getView().messages;

const lines = (session: RoomSession) =>
  entries(session).flatMap((entry) => (entry.kind === 'system' ? [entry.text] : []));

const chatIds = (session: RoomSession) =>
  entries(session).flatMap((entry) => (entry.kind === 'chat' ? [entry.id] : []));

const connected = async () => {
  const session = new RoomSession('room');
  await session.connect();
  return { session, socket: FakeSocket.last };
};

describe('RoomSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.opened = 0;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'test' }, setTimeout, clearInterval, setInterval });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ticket: 't', items: [] })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not treat a pong that beats the welcome as a missed event', async () => {
    const { socket } = await connected();
    socket.deliver('pong', pong(40));
    socket.deliver('pong', pong(40));
    expect(socket.closed).toBe(0);
  });

  it('tolerates events still in flight behind a pong', async () => {
    const { socket } = await connected();
    socket.deliver('welcome', welcome(5));
    socket.deliver('pong', pong(9));
    socket.deliver('state', { version: 9, playback: welcome(9).state.playback, cause: 'play' });
    socket.deliver('pong', pong(9));
    expect(socket.closed).toBe(0);
  });

  it('reconnects when a gap survives to the next pong', async () => {
    const { socket } = await connected();
    socket.deliver('welcome', welcome(5));
    socket.deliver('pong', pong(9));
    socket.deliver('pong', pong(9));
    expect(socket.closed).toBe(1);
  });

  it('treats a lower version on two pongs as Redis going backwards', async () => {
    const { socket } = await connected();
    socket.deliver('welcome', welcome(50));
    socket.deliver('pong', pong(12));
    socket.deliver('pong', pong(12));
    expect(socket.closed).toBe(1);
  });

  it('ignores a pong that has no version to report', async () => {
    const { socket } = await connected();
    socket.deliver('welcome', welcome(5));
    socket.deliver('pong', { t0: 1, ts: 0 });
    socket.deliver('pong', { t0: 1, ts: 0 });
    expect(socket.closed).toBe(0);
  });

  describe('version gaps', () => {
    it('asks for a snapshot instead of jumping forward', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(5));
      socket.deliver('playback', { version: 9, playback: { ...idle, status: 'paused' }, cause: 'pause' });
      expect(session.getView().version).toBe(5);
      expect(session.getView().playback.status).toBe('idle');
      expect(socket.ofType('sync')).toHaveLength(1);
    });

    it('asks once while a snapshot is on its way', async () => {
      const { socket } = await connected();
      socket.deliver('welcome', welcome(5));
      socket.deliver('playback', { version: 9, playback: idle, cause: 'pause' });
      socket.deliver('playback', { version: 10, playback: idle, cause: 'pause' });
      expect(socket.ofType('sync')).toHaveLength(1);
    });

    it('takes the snapshot, queue included', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(5));
      socket.deliver('playback', { version: 9, playback: idle, cause: 'pause' });
      socket.deliver('state', { version: 9, playback: idle, queue: [item('a')], cause: 'sync' });
      expect(session.getView().version).toBe(9);
      expect(session.getView().queue).toHaveLength(1);
      socket.deliver('pong', pong(9));
      socket.deliver('pong', pong(9));
      expect(socket.closed).toBe(0);
    });

    it('accepts a snapshot behind its own version after a rehydrate', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(50));
      socket.deliver('state', { version: 12, playback: idle, queue: [], cause: 'sync' });
      expect(session.getView().version).toBe(12);
      socket.deliver('playback', { version: 13, playback: { ...idle, status: 'paused' }, cause: 'pause' });
      expect(session.getView().version).toBe(13);
    });

    it('falls back to reconnecting if the snapshot never comes', async () => {
      const { socket } = await connected();
      socket.deliver('welcome', welcome(5));
      socket.deliver('playback', { version: 9, playback: idle, cause: 'pause' });
      vi.advanceTimersByTime(6000);
      socket.deliver('pong', pong(9));
      socket.deliver('pong', pong(9));
      expect(socket.closed).toBe(1);
    });

    it('applies the next version normally and drops repeats', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(5));
      const paused = { ...idle, item: 'a', status: 'paused', pos: 10 };
      socket.deliver('playback', { version: 6, playback: paused, cause: 'pause', by: 'Maya' });
      socket.deliver('playback', { version: 6, playback: paused, cause: 'pause', by: 'Maya' });
      socket.deliver('playback', { version: 4, playback: idle, cause: 'pause', by: 'Maya' });
      expect(session.getView().version).toBe(6);
      expect(lines(session)).toEqual(['Maya paused at 0:10']);
      expect(socket.ofType('sync')).toHaveLength(0);
    });
  });

  describe('playback listener', () => {
    const heard = async () => {
      const { session, socket } = await connected();
      const calls: boolean[] = [];
      session.onPlayback((_playback, resync) => calls.push(resync));
      return { socket, calls };
    };

    it('marks the welcome and snapshots as the room insisting', async () => {
      const { socket, calls } = await heard();
      socket.deliver('welcome', welcome(1));
      socket.deliver('state', { version: 1, playback: idle, queue: [], cause: 'sync' });
      expect(calls).toEqual([true, true]);
    });

    it('does not for an ordinary change', async () => {
      const { socket, calls } = await heard();
      socket.deliver('welcome', welcome(1));
      calls.length = 0;
      socket.deliver('state', { version: 2, playback: idle, queue: [], cause: 'settings' });
      expect(calls).toEqual([false]);
    });
  });

  describe('send and request', () => {
    it('says whether a message left', async () => {
      const { session, socket } = await connected();
      expect(session.send('react', { emoji: '🔥' })).toBe(true);
      socket.readyState = 3;
      expect(session.send('react', { emoji: '🔥' })).toBe(false);
    });

    it('resolves on the ack for its own id', async () => {
      const { session, socket } = await connected();
      let done = false;
      const pending = session.request('skip', { item: 'a' }).then(() => (done = true));
      expect(socket.sent.at(-1)).toMatchObject({ t: 'skip', d: { item: 'a' } });
      socket.deliver('ack', { id: 'someone-else' });
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      socket.ack();
      await pending;
      expect(done).toBe(true);
    });

    it('rejects with the server copy, and shows no notice', async () => {
      const { session, socket } = await connected();
      const pending = session.request('skip', { item: 'a' });
      socket.deliver('error', { re: socket.sent.at(-1)?.id, code: 'forbidden', message: 'The host controls this room.' });
      await expect(pending).rejects.toThrow('The host controls this room.');
      expect(session.getView().notices).toEqual([]);
    });

    it('still shows an error nobody is waiting for', async () => {
      const { session, socket } = await connected();
      socket.deliver('error', { re: '', code: 'forbidden', message: 'The host controls this room.' });
      expect(session.getView().notices[0]?.text).toBe('The host controls this room.');
    });

    it('rejects at once when offline', async () => {
      const { session, socket } = await connected();
      socket.readyState = 3;
      await expect(session.request('skip')).rejects.toThrow(/offline/);
    });

    it('rejects what was in flight when the connection drops', async () => {
      const { session, socket } = await connected();
      const pending = session.request('skip');
      socket.onclose?.();
      await expect(pending).rejects.toThrow(/dropped/);
    });

    it('gives up on an answer that never comes', async () => {
      const { session } = await connected();
      const pending = session.request('skip');
      const outcome = expect(pending).rejects.toThrow(/too long/);
      await vi.advanceTimersByTimeAsync(16_000);
      await outcome;
    });

    it('sends queue changes with their own arguments', async () => {
      const { session, socket } = await connected();
      const media = { ...item('a'), url: 'https://youtu.be/abc' };
      void session.queueAdd({ url: 'https://x.test/a.mp4' }, 'next');
      expect(socket.sent.at(-1)).toMatchObject({ t: 'queue.add', d: { url: 'https://x.test/a.mp4', mode: 'next' } });
      void session.queueAdd({ media }, 'now');
      expect(socket.sent.at(-1)).toMatchObject({ t: 'queue.add', d: { url: 'https://youtu.be/abc', mode: 'now' } });
      void session.queueMove('a', 2);
      expect(socket.sent.at(-1)).toMatchObject({ t: 'queue.move', d: { target: 'a', index: 2 } });
      void session.queueRemove('a');
      expect(socket.sent.at(-1)).toMatchObject({ t: 'queue.remove', d: { target: 'a' } });
    });
  });

  describe('rename', () => {
    const answer = (status: number, body: unknown) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

    it('saves the cookie, then renames over the open socket', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      answer(200, { user: { id: 'g_1', name: 'Maya', avatarUrl: '', signedIn: false } });

      const pending = session.rename('Maya');
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.ofType('rename')[0]?.d).toEqual({ name: 'Maya' });
      socket.ack();
      await pending;

      expect(session.getView().self?.name).toBe('Maya');
      expect(session.getView().connection).toBe('live');
      expect(socket.closed).toBe(0);
      expect(FakeSocket.opened).toBe(1);
    });

    it('rejects with the server copy and touches nothing', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      answer(400, { code: 'invalid', message: 'Names can be up to 32 characters.' });
      await expect(session.rename('x'.repeat(40))).rejects.toThrow('Names can be up to 32 characters.');
      expect(session.getView().self?.name).toBe('Ada');
      expect(socket.ofType('rename')).toHaveLength(0);
    });

    it('rejects with readable copy when the network is down', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      await expect(session.rename('Maya')).rejects.toThrow('You’re offline right now. Try again once you’re back.');
    });

    it('reconnects if the socket cannot take the new name', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      answer(200, { user: { id: 'g_1', name: 'Maya', avatarUrl: '', signedIn: false } });
      const pending = session.rename('Maya');
      await vi.advanceTimersByTimeAsync(0);
      socket.deliver('error', { re: socket.sent.at(-1)?.id, code: 'rate_limited', message: 'Slow down a little.' });
      await pending;
      expect(socket.closed).toBe(1);
    });

    it('picks up a rename from another tab', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.deliver('member.rename', { userId: 'g_1', name: 'Maya' });
      expect(session.getView().self?.name).toBe('Maya');
    });
  });

  describe('connection state', () => {
    it('records when it went offline and clears it on return', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      expect(session.getView().offlineSince).toBeNull();

      vi.setSystemTime(5000);
      socket.onclose?.();
      expect(session.getView().offlineSince).toBe(5000);
      expect(session.getView().connection).toBe('reconnecting');

      vi.setSystemTime(6000);
      await vi.advanceTimersByTimeAsync(6000);
      expect(session.getView().offlineSince).toBe(5000);
      FakeSocket.last.deliver('welcome', welcome(1));
      expect(session.getView().offlineSince).toBeNull();
    });

    it('retry reconnects now and resets the backoff', async () => {
      const { session, socket } = await connected();
      for (let i = 0; i < 4; i += 1) {
        FakeSocket.last.onclose?.();
        await vi.advanceTimersByTimeAsync(6000);
      }
      FakeSocket.last.onclose?.();
      const before = FakeSocket.opened;

      session.retry();
      await vi.advanceTimersByTimeAsync(0);
      expect(FakeSocket.opened).toBe(before + 1);

      // The timer it replaced must not open a second socket.
      await vi.advanceTimersByTimeAsync(6000);
      expect(FakeSocket.opened).toBe(before + 1);

      // Backoff restarted: the next failure comes back within the first step.
      FakeSocket.last.onclose?.();
      await vi.advanceTimersByTimeAsync(500);
      expect(FakeSocket.opened).toBe(before + 2);
      expect(socket).not.toBe(FakeSocket.last);
    });

    it('survives a mount, cleanup and mount with one socket', async () => {
      const session = new RoomSession('room');
      const first = session.connect();
      session.close();
      const second = session.connect();
      await Promise.all([first, second]);
      expect(FakeSocket.opened).toBe(1);
      FakeSocket.last.deliver('welcome', welcome(1));
      expect(session.getView().connection).toBe('live');
    });

    it('stays quiet after close', async () => {
      const { session, socket } = await connected();
      session.close();
      expect(socket.closed).toBe(1);
      socket.onclose?.();
      await vi.advanceTimersByTimeAsync(6000);
      expect(FakeSocket.opened).toBe(1);
    });

    it('calls a silent socket dead within ten seconds, without waiting for onclose', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(7900);
      expect(socket.closed).toBe(0);
      await vi.advanceTimersByTimeAsync(2100);
      expect(socket.closed).toBe(1);
      expect(socket.onclose).toBeNull();
      expect(session.getView().connection).toBe('reconnecting');
      expect(session.getView().offlineSince).not.toBeNull();
      await vi.advanceTimersByTimeAsync(6000);
      expect(FakeSocket.opened).toBe(2);
    });

    it('keeps a socket that goes on answering', async () => {
      const { socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.onopen?.();
      for (let i = 0; i < 20; i += 1) {
        await vi.advanceTimersByTimeAsync(5000);
        socket.deliver('pong', { t0: 0, ts: 0 });
      }
      expect(socket.closed).toBe(0);
    });

    it('counts any frame as a sign of life, not just a pong', async () => {
      const { socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(6000);
      socket.deliver('react', { emoji: '🔥', name: 'Maya' });
      await vi.advanceTimersByTimeAsync(6000);
      expect(socket.closed).toBe(0);
    });

    it('does not blame the socket when the browser slept through its timers', async () => {
      const { socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.onopen?.();
      vi.setSystemTime(Date.now() + 60_000); // No timer ran for a minute.
      await vi.advanceTimersByTimeAsync(3000);
      expect(socket.closed).toBe(0);
    });

    it('samples the clock and checks versions at the old pace, not on every ping', async () => {
      const { socket } = await connected();
      socket.deliver('welcome', welcome(9));
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(5000);
      socket.deliver('pong', { t0: 0, ts: 0 });
      await vi.advanceTimersByTimeAsync(4000);
      const pings = socket.ofType('ping').slice(-3);
      expect(pings.map((ping) => ping.d?.t0 !== undefined)).toEqual([false, false, true]);
      // A pong that only proves life can't count towards a version gap.
      socket.deliver('pong', { t0: 0, ts: 0, version: 12 });
      socket.deliver('pong', { t0: 0, ts: 0, version: 12 });
      expect(socket.closed).toBe(0);
    });

    it('fails for good on a closed room, not on a network blip', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      const session = new RoomSession('room');
      await session.connect();
      expect(session.getView().connection).toBe('reconnecting');

      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ code: 'room_closed', message: 'This room has closed.' }), { status: 410 },
      )));
      await vi.advanceTimersByTimeAsync(6000);
      expect(session.getView().connection).toBe('failed');
      expect(session.getView().failure).toBe('This room has closed.');
    });

    it('knows when nobody else is here', async () => {
      const { session, socket } = await connected();
      expect(session.getView().alone).toBe(false);
      socket.deliver('welcome', { ...welcome(1), members: [ada] });
      expect(session.getView().alone).toBe(true);
      socket.deliver('members', { members: [ada, maya] });
      expect(session.getView().alone).toBe(false);
      socket.deliver('members', { members: [ada] });
      expect(session.getView().alone).toBe(true);
    });
  });

  describe('system lines', () => {
    const live = async (members = [ada]) => {
      const { session, socket } = await connected();
      socket.deliver('welcome', { ...welcome(1), members });
      await vi.advanceTimersByTimeAsync(0);
      return { session, socket };
    };

    it('announces arrivals and departures, but not the first member list', async () => {
      const { session, socket } = await live([ada, maya]);
      expect(lines(session)).toEqual([]);
      socket.deliver('members', { members: [ada, maya, sam] });
      socket.deliver('members', { members: [ada, sam] });
      expect(lines(session)).toEqual(['Sam joined', 'Maya left']);
    });

    it('stays silent through a reload', async () => {
      const { session, socket } = await live([ada, maya]);
      socket.deliver('members', { members: [ada] });
      expect(lines(session)).toEqual(['Maya left']);
      vi.advanceTimersByTime(2000);
      socket.deliver('members', { members: [ada, maya] });
      expect(lines(session)).toEqual([]);
    });

    it('announces someone who comes back much later', async () => {
      const { session, socket } = await live([ada, maya]);
      socket.deliver('members', { members: [ada] });
      vi.advanceTimersByTime(60_000);
      socket.deliver('members', { members: [ada, maya] });
      expect(lines(session)).toEqual(['Maya left', 'Maya joined']);
    });

    it('does not announce the people it finds on reconnecting', async () => {
      const { session, socket } = await live([ada]);
      socket.onclose?.();
      await vi.advanceTimersByTimeAsync(6000);
      FakeSocket.last.deliver('welcome', { ...welcome(1), members: [ada, maya] });
      expect(lines(session)).toEqual([]);
    });

    it('says who paused and where', async () => {
      const { session, socket } = await live();
      socket.deliver('playback', { version: 2, playback: { ...idle, status: 'paused', pos: 192 }, cause: 'pause', by: 'Maya' });
      expect(lines(session)).toEqual(['Maya paused at 3:12']);
    });

    it('tells a jump forward from a jump back', async () => {
      const { session, socket } = await live();
      const at = (pos: number) => ({ ...idle, status: 'paused', pos });
      socket.deliver('playback', { version: 2, playback: at(300), cause: 'pause', by: 'Sam' });
      socket.deliver('playback', { version: 3, playback: at(760), cause: 'seek', by: 'Maya' });
      vi.advanceTimersByTime(10_000);
      socket.deliver('playback', { version: 4, playback: at(125), cause: 'seek', by: 'Maya' });
      expect(lines(session).slice(1)).toEqual(['Maya jumped to 12:40', 'Maya went back to 2:05']);
    });

    it('collapses one person scrubbing into one line', async () => {
      const { session, socket } = await live();
      const at = (pos: number) => ({ ...idle, status: 'paused', pos });
      socket.deliver('playback', { version: 2, playback: at(600), cause: 'pause', by: 'Sam' });
      [610, 620, 300].forEach((pos, i) => {
        vi.advanceTimersByTime(500);
        socket.deliver('playback', { version: 3 + i, playback: at(pos), cause: 'seek', by: 'Maya' });
      });
      expect(lines(session).slice(1)).toEqual(['Maya went back to 5:00']);
    });

    it('keeps two people scrubbing apart', async () => {
      const { session, socket } = await live();
      const at = (pos: number) => ({ ...idle, status: 'paused', pos });
      socket.deliver('playback', { version: 2, playback: at(100), cause: 'seek', by: 'Maya' });
      socket.deliver('playback', { version: 3, playback: at(200), cause: 'seek', by: 'Sam' });
      expect(lines(session)).toHaveLength(2);
    });

    it('names what was added and what comes up', async () => {
      const { session, socket } = await live();
      const zelda = { ...item('z'), title: 'Zelda trailer' };
      const current = { ...idle, item: 'a', status: 'playing' };
      socket.deliver('state', { version: 2, playback: current, queue: [item('a')], cause: 'queue.add', by: 'Sam' });
      socket.deliver('state', { version: 3, playback: current, queue: [item('a'), zelda], cause: 'queue.add', by: 'Maya' });
      socket.deliver('state', { version: 4, playback: { ...current, item: 'z' }, queue: [zelda], cause: 'ended' });
      expect(lines(session)).toEqual(['Sam added Video a', 'Maya added Zelda trailer', 'Up next: Zelda trailer']);
    });

    const settings = (mode: string) => ({ controlMode: mode, queueMode: mode });
    const locked = { version: 2, playback: idle, queue: [], settings: settings('hosts'), cause: 'settings', by: 'Maya' };

    it('says who locked and unlocked the room', async () => {
      const { session, socket } = await live();
      socket.deliver('state', locked);
      socket.deliver('state', { ...locked, version: 3, settings: settings('everyone') });
      expect(lines(session)).toEqual(['Maya turned on host controls', 'Maya turned off host controls']);
    });

    it('leaves a handover to the server, in the toast’s own words', async () => {
      const { session, socket } = await live();
      socket.deliver('state', locked);
      socket.deliver('state', { version: 3, playback: idle, queue: [], settings: settings('everyone'), cause: 'settings.release' });
      socket.deliver('notice', { kind: 'host', text: 'Golden Otter left, so anyone can control playback.' });
      socket.deliver('state', { version: 4, playback: idle, queue: [], settings: settings('hosts'), cause: 'settings.restore' });
      socket.deliver('notice', { kind: 'host', text: 'Golden Otter is back, so they control playback again.' });
      expect(lines(session)).toEqual([
        'Maya turned on host controls',
        'Golden Otter left, so anyone can control playback.',
        'Golden Otter is back, so they control playback again.',
      ]);
      expect(session.getView().notices.map((notice) => notice.text)).toEqual([
        'Golden Otter left, so anyone can control playback.',
        'Golden Otter is back, so they control playback again.',
      ]);
    });

    it('records a skip in the chat, but not every notice', async () => {
      const { session, socket } = await live();
      socket.deliver('notice', { kind: 'skipped', text: 'Skipped “Clip” because it wouldn’t load.' });
      socket.deliver('notice', { text: 'That didn’t go through.' });
      expect(lines(session)).toEqual(['Skipped “Clip” because it wouldn’t load.']);
    });

    describe('pauses that were not pauses', () => {
      const playing = async (durationMs = 300_000) => {
        const { session, socket } = await connected();
        const video = { ...item('a'), durationMs };
        const base = welcome(1);
        const playback = { ...idle, item: 'a', status: 'playing', pos: 10, at: Date.now() };
        socket.deliver('welcome', { ...base, state: { ...base.state, playback, queue: [video] }, members: [ada] });
        await vi.advanceTimersByTimeAsync(0);
        const at = (status: string, pos: number) => ({ ...idle, item: 'a', status, pos, at: Date.now() });
        return { session, socket, at };
      };

      it('still says when someone really paused', async () => {
        const { session, socket, at } = await playing();
        socket.deliver('playback', { version: 2, playback: at('paused', 10), cause: 'pause', by: 'Asha' });
        await vi.advanceTimersByTimeAsync(5000);
        socket.deliver('playback', { version: 3, playback: at('playing', 10), cause: 'play', by: 'Asha' });
        expect(lines(session)).toEqual(['Asha paused at 0:10']);
      });

      it('writes nothing when the video ran out, for any number of viewers', async () => {
        const { session, socket, at } = await playing(25_000);
        socket.deliver('playback', { version: 2, playback: at('paused', 25), cause: 'pause', by: 'Asha' });
        socket.deliver('playback', { version: 3, playback: at('paused', 25), cause: 'pause', by: 'Pia' });
        expect(lines(session)).toEqual([]);
      });

      it('takes the line back when a video of unknown length ends', async () => {
        const { session, socket, at } = await playing(0);
        socket.deliver('playback', { version: 2, playback: at('paused', 10), cause: 'pause', by: 'Asha' });
        socket.deliver('playback', { version: 3, playback: at('paused', 10), cause: 'pause', by: 'Pia' });
        socket.deliver('state', { version: 4, playback: idle, queue: [], cause: 'ended' });
        expect(lines(session)).toEqual([]);
      });

      it('calls a pause away from the room’s position a jump', async () => {
        const { session, socket, at } = await playing();
        socket.deliver('playback', { version: 2, playback: at('paused', 25), cause: 'pause', by: 'Asha' });
        socket.deliver('playback', { version: 3, playback: at('playing', 25), cause: 'play', by: 'Asha' });
        expect(lines(session)).toEqual(['Asha jumped to 0:25']);
      });

      it('folds a pause and a play that moved the picture into one jump', async () => {
        const { session, socket, at } = await playing();
        socket.deliver('playback', { version: 2, playback: at('paused', 10), cause: 'pause', by: 'Asha' });
        socket.deliver('playback', { version: 3, playback: at('playing', 25), cause: 'play', by: 'Asha' });
        expect(lines(session)).toEqual(['Asha jumped to 0:25']);
      });

      it('leaves no line for a pause undone at once', async () => {
        const { session, socket, at } = await playing();
        socket.deliver('playback', { version: 2, playback: at('paused', 10), cause: 'pause', by: 'Asha' });
        socket.deliver('playback', { version: 3, playback: at('playing', 10), cause: 'play', by: 'Asha' });
        expect(lines(session)).toEqual([]);
      });

      it('keeps a pause that someone else resumed', async () => {
        const { session, socket, at } = await playing();
        socket.deliver('playback', { version: 2, playback: at('paused', 10), cause: 'pause', by: 'Asha' });
        socket.deliver('playback', { version: 3, playback: at('playing', 10), cause: 'play', by: 'Pia' });
        expect(lines(session)).toEqual(['Asha paused at 0:10']);
      });
    });

    it('stays quiet when settings change nothing about control', async () => {
      const { session, socket } = await live();
      socket.deliver('state', { ...locked, settings: { controlMode: 'everyone', queueMode: 'hosts' } });
      expect(lines(session)).toEqual([]);
    });

    it('writes nothing for a snapshot', async () => {
      const { session, socket } = await live();
      socket.deliver('state', { version: 9, playback: { ...idle, item: 'a' }, queue: [item('a')], cause: 'sync', by: 'x' });
      expect(lines(session)).toEqual([]);
    });
  });

  describe('chat history', () => {
    const history = (...ids: number[]) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        ticket: 't',
        items: ids.map((id) => chatLine(id)), // Newest first, as the server sends it.
      }))));

    it('shows history oldest first', async () => {
      history(3, 2, 1);
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(chatIds(session)).toEqual([1, 2, 3]);
    });

    it('does not repeat a message that arrived live first', async () => {
      history(3, 2, 1);
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.deliver('chat', { message: chatLine(3) });
      await vi.advanceTimersByTimeAsync(0);
      expect(chatIds(session)).toEqual([1, 2, 3]);
    });

    it('does not repeat history after a reconnect', async () => {
      history(2, 1);
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      socket.onclose?.();
      await vi.advanceTimersByTimeAsync(6000);
      FakeSocket.last.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(chatIds(session)).toEqual([1, 2]);
    });

    it('does not repeat a live message delivered twice', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.deliver('chat', { message: chatLine(1) });
      socket.deliver('chat', { message: chatLine(1) });
      expect(chatIds(session)).toEqual([1]);
    });

    it('marks what was said before joining, and only that', async () => {
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ items: [chatLine(1), chatLine(2)] })));
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      socket.deliver('chat', { message: chatLine(3) });
      expect(entries(session).map((entry) => entry.kind === 'chat' && entry.history === true)).toEqual([true, true, false]);
    });

    it('does not mark what was missed during a reconnect', async () => {
      const replies = [{ ticket: 't' }, { items: [chatLine(1)] }, { items: [chatLine(1), chatLine(2)] }];
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify(replies.shift() ?? { ticket: 't', items: [] })));
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      socket.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(entries(session).map((entry) => entry.kind === 'chat' && entry.history === true)).toEqual([true, false]);
    });

    it('survives a failed fetch', async () => {
      const { session, socket } = await connected();
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
      socket.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getView().messages).toEqual([]);
      expect(session.getView().connection).toBe('live');
    });
  });

  describe('own chat lines', () => {
    const sent = async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      const result = session.sendChat('hello');
      return { session, socket, result, line: () => entries(session).find((entry) => entry.kind === 'chat') };
    };
    const echo = (id: number, body = 'hello', at = Date.now()) => ({
      message: { id, userId: 'g_1', author: 'Ada', body, createdAt: new Date(at).toISOString() },
    });

    it('shows the line at once, marked as sending', async () => {
      const { line } = await sent();
      expect(line()).toMatchObject({ body: 'hello', author: 'Ada', delivery: 'sending' });
    });

    it('is one line once the server echoes it, whichever answer lands first', async () => {
      const first = await sent();
      first.socket.deliver('chat', echo(7));
      first.socket.ack();
      await first.result;
      expect(chatIds(first.session)).toHaveLength(1);
      expect(first.line()).toMatchObject({ serverId: 7, delivery: undefined });

      const second = await sent();
      second.socket.ack();
      await second.result;
      expect(second.line()).toMatchObject({ delivery: undefined });
      second.socket.deliver('chat', echo(8));
      expect(chatIds(second.session)).toHaveLength(1);
    });

    it('keeps its id when confirmed, so unread counts and scrolling see one line', async () => {
      const { socket, line } = await sent();
      const id = line()?.id;
      socket.deliver('chat', echo(7));
      expect(line()?.id).toBe(id);
    });

    it('says it was not sent after five seconds', async () => {
      const { result, line } = await sent();
      await vi.advanceTimersByTimeAsync(4900);
      expect(line()).toMatchObject({ delivery: 'sending' });
      await vi.advanceTimersByTimeAsync(200);
      expect(line()).toMatchObject({ delivery: 'failed' });
      expect((await result).limited).toBe(false);
    });

    it('fails the line when the socket drops under it', async () => {
      const { socket, result, line } = await sent();
      socket.onclose?.();
      await result;
      expect(line()).toMatchObject({ delivery: 'failed' });
    });

    it('recovers a line the server had all along', async () => {
      const { socket, line } = await sent();
      await vi.advanceTimersByTimeAsync(6000);
      socket.deliver('chat', echo(7));
      expect(line()).toMatchObject({ serverId: 7, delivery: undefined });
    });

    it('reports a rate limit, so the text can go back in the box', async () => {
      const { socket, result } = await sent();
      socket.deliver('error', { re: socket.sent.at(-1)?.id, code: 'rate_limited', message: 'Slow down a little.' });
      expect((await result).limited).toBe(true);
    });

    it('retries from the end of the chat', async () => {
      const { session, socket, result, line } = await sent();
      socket.onclose?.();
      const { id } = await result;
      await vi.advanceTimersByTimeAsync(6000);
      const next = FakeSocket.last;
      next.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      next.deliver('chat', { message: chatLine(1) });

      session.retryChat(id);
      expect(next.ofType('chat.send').at(-1)?.d).toEqual({ text: 'hello' });
      expect(entries(session).at(-1)).toMatchObject({ id, delivery: 'sending' });
      next.ack();
      await vi.advanceTimersByTimeAsync(0);
      expect(line()?.kind).toBe('chat');
      expect(entries(session).at(-1)).toMatchObject({ id, delivery: undefined });
    });

    it('confirms a lost line from the history after a reconnect, without repeating it', async () => {
      const { session, socket, result } = await sent();
      const stored = echo(7).message;
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ticket: 't', items: [stored] })));
      socket.onclose?.();
      await result;
      await vi.advanceTimersByTimeAsync(6000);
      FakeSocket.last.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(chatIds(session)).toHaveLength(1);
      expect(entries(session).at(-1)).toMatchObject({ serverId: 7, delivery: undefined });
    });

    it('does not mistake an old message for the one that was lost', async () => {
      const { session, socket, result } = await sent();
      const old = echo(3, 'hello', Date.now() - 60_000).message;
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ticket: 't', items: [old] })));
      socket.onclose?.();
      await result;
      await vi.advanceTimersByTimeAsync(6000);
      FakeSocket.last.deliver('welcome', welcome(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(chatIds(session)).toHaveLength(2);
      expect(entries(session).at(-1)).toMatchObject({ delivery: 'failed' });
    });

    it('takes a line away on request', async () => {
      const { session, result } = await sent();
      await vi.advanceTimersByTimeAsync(6000);
      session.discardChat((await result).id);
      expect(chatIds(session)).toEqual([]);
    });
  });

  describe('jumps', () => {
    const queued = async () => {
      const { session, socket } = await connected();
      const base = playingWelcome('a');
      const queue = [item('a'), item('b'), item('c')];
      socket.deliver('welcome', { ...base, state: { ...base.state, queue } });
      await vi.advanceTimersByTimeAsync(0);
      const moved = { version: 2, playback: { ...idle, item: 'c' }, queue: [item('c'), item('b')], cause: 'queue.play', by: 'Asha' };
      return { session, socket, moved };
    };

    it('offers an undo for five seconds', async () => {
      const { session, socket, moved } = await queued();
      socket.deliver('state', moved);
      expect(session.getView().jump).toEqual({ id: 'c', by: 'Asha', title: 'Video c' });
      await vi.advanceTimersByTimeAsync(4900);
      expect(session.getView().jump).not.toBeNull();
      await vi.advanceTimersByTimeAsync(200);
      expect(session.getView().jump).toBeNull();
    });

    it('asks the server to put it back', async () => {
      const { session, socket, moved } = await queued();
      socket.deliver('state', moved);
      const undone = session.undoJump('c');
      expect(socket.ofType('queue.undo').at(-1)?.d).toEqual({ target: 'c' });
      socket.ack();
      await expect(undone).resolves.toBeUndefined();
    });

    it('withdraws the offer when the video changes again', async () => {
      const { session, socket, moved } = await queued();
      socket.deliver('state', moved);
      socket.deliver('state', { version: 3, playback: { ...idle, item: 'b' }, queue: [item('b')], cause: 'skip', by: 'Pia' });
      expect(session.getView().jump).toBeNull();
    });

    it('offers nothing for a video that simply came up next', async () => {
      const { session, socket } = await queued();
      socket.deliver('state', { version: 2, playback: { ...idle, item: 'b' }, queue: [item('b'), item('c')], cause: 'ended' });
      expect(session.getView().jump).toBeNull();
    });

    it('says what happened in the chat', async () => {
      const { session, socket, moved } = await queued();
      socket.deliver('state', moved);
      socket.deliver('state', { version: 3, playback: { ...idle, item: 'a' }, queue: [item('a')], cause: 'queue.undo', by: 'Pia' });
      expect(lines(session)).toEqual(['Asha jumped to Video c', 'Pia went back to Video a']);
    });
  });

  describe('viewer health', () => {
    it('starts over when the video changes', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.deliver('member.status', { userId: 'g_2', state: 'synced' });
      session.reportStatus('synced', 0);
      session.reportStatus('synced', 0);
      expect(socket.ofType('status')).toHaveLength(1);

      socket.deliver('state', { version: 2, playback: { ...idle, item: 'b' }, queue: [item('b')], cause: 'skip' });
      expect(session.getView().viewerStates).toEqual({});
      session.reportStatus('synced', 0);
      expect(socket.ofType('status')).toHaveLength(2);
    });

    it('keeps unavailable until the video changes', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', playingWelcome('a'));
      socket.deliver('member.status', { userId: 'g_2', state: 'unavailable', item: 'a' });
      socket.deliver('member.status', { userId: 'g_2', state: 'buffering' });
      expect(session.getView().viewerStates).toEqual({ g_2: 'unavailable' });

      socket.deliver('state', { version: 2, playback: { ...idle, item: 'b' }, queue: [item('b')], cause: 'skip' });
      socket.deliver('member.status', { userId: 'g_2', state: 'synced' });
      expect(session.getView().viewerStates).toEqual({ g_2: 'synced' });
    });

    it('ignores unavailable for a video that has gone', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', playingWelcome('b'));
      socket.deliver('member.status', { userId: 'g_2', state: 'unavailable', item: 'a' });
      expect(session.getView().viewerStates).toEqual({});
    });

    it('stops reporting health for a video it cannot play', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', playingWelcome('a'));
      socket.deliver('member.status', { userId: 'g_1', state: 'unavailable', item: 'a' });
      session.reportStatus('buffering', 0);
      expect(socket.ofType('status')).toHaveLength(0);
    });

    it('reports again after a reconnect', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      session.reportStatus('synced', 0);
      socket.onclose?.();
      await vi.advanceTimersByTimeAsync(6000);
      FakeSocket.last.deliver('welcome', welcome(1));
      session.reportStatus('synced', 0);
      expect(FakeSocket.last.ofType('status')).toHaveLength(1);
    });

    it('does not count a report that could not be sent', async () => {
      const { session, socket } = await connected();
      socket.deliver('welcome', welcome(1));
      socket.readyState = 3;
      session.reportStatus('synced', 0);
      socket.readyState = FakeSocket.OPEN;
      session.reportStatus('synced', 0);
      expect(socket.ofType('status')).toHaveLength(1);
    });
  });
});
