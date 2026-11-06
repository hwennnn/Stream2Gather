// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry, ChatResult, RoomSession, RoomView } from '../room/session';
import { ChatPanel } from './ChatPanel';

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
      inviteUrl="http://x/r/y"
      onCopyInvite={() => {}}
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
