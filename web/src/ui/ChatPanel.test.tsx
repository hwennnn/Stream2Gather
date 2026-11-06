// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry, ChatResult, RoomSession, RoomView } from '../room/session';
import { ChatPanel } from './ChatPanel';
import { splitLinks } from './format';

vi.mock('./format', async (original) => {
  const real = await original<typeof import('./format')>();
  return { ...real, splitLinks: vi.fn(real.splitLinks) };
});

const self = { userId: 'me', name: 'Ada', role: 'member' as const };

const view = (messages: ChatEntry[], patch: Partial<RoomView> = {}): RoomView =>
  ({ self, members: [self], messages, reactions: [], queue: [], offlineSince: null, alone: false, settings: { controlMode: 'everyone', queueMode: 'everyone' }, ...patch }) as RoomView;

const line = (patch: Partial<Extract<ChatEntry, { kind: 'chat' }>>): ChatEntry => ({
  kind: 'chat', id: 'c1', userId: 'me', author: 'Ada', body: 'hello', createdAt: new Date(0).toISOString(), ...patch,
});

const setup = (messages: ChatEntry[] = [], patch: Partial<RoomView> = {}) => {
  let finish: (result: ChatResult) => void = () => {};
  const session = {
    sendChat: vi.fn(() => new Promise<ChatResult>((resolve) => (finish = resolve))),
    retryChat: vi.fn(),
    discardChat: vi.fn(),
  };
  render(
    <ChatPanel
      session={session as unknown as RoomSession}
      view={view(messages, patch)}
      active
      inviteCopied={false}
      inviteUrl="http://x/r/y"
      onCopyInvite={() => {}}
      onInvite={() => {}}
      onToast={() => {}}
    />,
  );
  const box = screen.getByLabelText<HTMLInputElement>('Message');
  const send = (text: string) => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
  };
  return { session, box, send, answer: (result: ChatResult) => act(async () => finish(result)) };
};

describe('ChatPanel system lines', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers the video a skip took away, after its toast has gone', () => {
    setup([{ kind: 'system', id: 'l1', text: 'Skipped “Clip”.', url: 'https://youtu.be/x', createdAt: new Date(0).toISOString() }]);
    expect(screen.getByRole('link', { name: 'Open on YouTube' }).getAttribute('href')).toBe('https://youtu.be/x');
  });
});

describe('ChatPanel invitations', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('asks for company while the room is still picking', () => {
    setup([], { alone: true });
    expect(screen.getByText('Invite someone while you pick')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
  });

  it('offers the link once something is playing', () => {
    setup([], { alone: true, queue: [{}] as RoomView['queue'] });
    expect(screen.queryByText('Invite someone while you pick')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });
});

describe('ChatPanel sending', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    Element.prototype.scrollTo = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('clears the box at once, because the line now holds the text', () => {
    const { session, box, send } = setup();
    send('hello');
    expect(session.sendChat).toHaveBeenCalledWith('hello');
    expect(box.value).toBe('');
  });

  it('puts rate-limited text back in the box and takes the line away', async () => {
    const { session, box, send, answer } = setup();
    send('hello');
    await answer({ id: 'c1', limited: true });
    expect(box.value).toBe('hello');
    expect(session.discardChat).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('status').textContent).toMatch(/Slow down/);
  });

  it('leaves a newer draft alone, and keeps the refused line in the chat', async () => {
    const { session, box, send, answer } = setup();
    send('hello');
    fireEvent.change(box, { target: { value: 'next thought' } });
    await answer({ id: 'c1', limited: true });
    expect(box.value).toBe('next thought');
    expect(session.discardChat).not.toHaveBeenCalled();
  });

  it('dims a line that is on its way', () => {
    setup([line({ delivery: 'sending' })]);
    expect(screen.getByText('hello').className).toMatch(/opacity-55/);
    expect(screen.queryByText('Not sent.')).toBeNull();
  });

  it('offers a retry on a line that failed', () => {
    const { session } = setup([line({ delivery: 'failed' })]);
    expect(screen.getByText('Not sent.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(session.retryChat).toHaveBeenCalledWith('c1');
  });

  it('waits for the connection before retrying', () => {
    setup([line({ delivery: 'failed' })], { offlineSince: 1 });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retry' }).disabled).toBe(true);
  });

  it('shows a settled line at full strength', () => {
    setup([line({ serverId: 7 })]);
    expect(screen.getByText('hello').className).not.toMatch(/opacity-55/);
  });
});

describe('a long chat', () => {
  const lines = Array.from({ length: 5 }, (_, n) => line({ id: n + 1, userId: `u${n}`, author: `Person ${n}`, body: `line ${n}` }));
  const session = {} as RoomSession;
  const onToast = () => {};
  const panel = (next: RoomView) => (
    <ChatPanel session={session} view={next} active inviteUrl="" inviteCopied={false} onCopyInvite={() => {}} onInvite={() => {}} onToast={onToast} />
  );
  const drawn = () => vi.mocked(splitLinks).mock.calls.length;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.mocked(splitLinks).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('leaves its lines alone while someone types', () => {
    render(panel(view(lines)));
    const before = drawn();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'h' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } });
    expect(drawn()).toBe(before);
  });

  it('leaves its lines alone when something else in the room changes', () => {
    const { rerender } = render(panel(view(lines)));
    const before = drawn();
    rerender(panel(view(lines, { viewerStates: { u1: 'synced' }, reactions: [] })));
    expect(drawn()).toBe(before);
  });

  it('draws only the new line when one arrives', () => {
    const { rerender } = render(panel(view(lines)));
    const before = drawn();
    rerender(panel(view([...lines, line({ id: 6, userId: 'u9', author: 'New', body: 'new' })])));
    expect(drawn()).toBe(before + 1);
    expect(screen.getByText('new')).toBeTruthy();
  });

  it('redraws a line whose delivery changed', () => {
    const sending = line({ id: 'c9', delivery: 'sending', body: 'on its way' });
    const { container, rerender } = render(panel(view([...lines, sending])));
    expect(container.querySelector('[data-delivery=sending]')).toBeTruthy();
    rerender(panel(view([...lines, { ...sending, delivery: undefined } as ChatEntry])));
    expect(container.querySelector('[data-delivery=sending]')).toBeNull();
  });

  it('still takes away the add button when the room goes offline', () => {
    const video = line({ id: 7, userId: 'u8', body: 'https://youtu.be/aqz-KE-bpKQ' });
    const { rerender } = render(panel(view([video])));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add to queue' }).disabled).toBe(false);
    rerender(panel(view([video], { offlineSince: 1 })));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add to queue' }).disabled).toBe(true);
  });
});
