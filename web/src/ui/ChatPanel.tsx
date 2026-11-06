import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { request } from '../api/http';
import type { ChatEntry, ChatLine, RoomSession, RoomView } from '../room/session';
import { formatClock, isYouTubeUrl, plural, splitLinks } from './format';
import { Icon } from './Icon';
import { firstName, hueOf } from './people';
import { ReactionPicker } from './Reactions';
import { canQueue, chatScroll, countUnread, isOffline } from './rules';
import { toastError } from './Toasts';

const STICK_PX = 80;
const GROUP_GAP_MS = 5 * 60_000;
const COUNT_FROM = 450;
const MAX_LENGTH = 500;

type Props = {
  session: RoomSession;
  view: RoomView;
  active: boolean;
  onToast: (text: string) => void;
  /** Sits between the log and the box, so it shortens the log rather than covering a line. */
  toasts?: ReactNode;
};

type Block = { kind: 'system'; entry: Extract<ChatEntry, { kind: 'system' }> } | { kind: 'chat'; messages: ChatLine[] } | { kind: 'time'; at: string };

const toBlocks = (entries: ChatEntry[]): Block[] => {
  const blocks: Block[] = [];
  let spoken: ChatLine | undefined;
  for (const entry of entries) {
    if (entry.kind === 'system') {
      blocks.push({ kind: 'system', entry });
      continue;
    }
    const gap = spoken ? Date.parse(entry.createdAt) - Date.parse(spoken.createdAt) : Infinity;
    if (gap >= GROUP_GAP_MS) blocks.push({ kind: 'time', at: entry.createdAt });
    const last = blocks.at(-1);
    if (last?.kind === 'chat' && spoken?.userId === entry.userId) last.messages.push(entry);
    else blocks.push({ kind: 'chat', messages: [entry] });
    spoken = entry;
  }
  return blocks;
};

const isSpoiler = (entry: ChatEntry) => entry.kind === 'chat' && entry.missed === true;

/** Goes to what was missed, or if it can't be watched any more, shows the chat instead. */
const catchUp = async (slug: string, reveal: () => void) => {
  const crew = `/v1/crews/${encodeURIComponent(slug)}`;
  const { items } = await request<{ items: { itemId: number }[] }>(`${crew}/missed`).catch(() => ({ items: [] }));
  if (items[0]) window.location.assign(`/r/${encodeURIComponent(slug)}/catchup/${items[0].itemId}`);
  else reveal();
};

export const ChatPanel = ({ session, view, active, onToast, toasts }: Props) => {
  const [text, setText] = useState('');
  const [slow, setSlow] = useState(false);
  const [missed, setMissed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const draft = useRef('');
  const offline = isOffline(view);
  const [revealed, setRevealed] = useState(false);
  const spoilers = useMemo(() => view.messages.filter(isSpoiler).length, [view.messages]);
  const entries = useMemo(() => (revealed ? view.messages : view.messages.filter((entry) => !isSpoiler(entry))), [view.messages, revealed]);
  const empty = text.trim().length === 0;

  const blocks = useMemo(() => toBlocks(entries), [entries]);
  const selfId = view.self?.userId;
  const canAdd = canQueue(view);
  // Typing and everything else in the room redraw this panel, so the lines depend only on what they show.
  const lines = useMemo(
    () =>
      blocks.map((block) => {
        if (block.kind === 'time') {
          return (
            <time key={block.at} dateTime={block.at} className="fig mt-4 text-dim first:mt-auto">
              {formatClock(block.at)}
            </time>
          );
        }
        if (block.kind === 'system') {
          return (
            <p key={block.entry.id} className="mt-2 text-[13px] leading-[18px] text-dim first:mt-auto">
              {block.entry.text}
              {block.entry.url && (
                <>
                  {' '}
                  <a href={block.entry.url} target="_blank" rel="noreferrer noopener" className="underline">
                    Open on YouTube
                  </a>
                </>
              )}
            </p>
          );
        }
        return (
          <MessageGroup key={block.messages[0]?.id} session={session} selfId={selfId} canAdd={canAdd} offline={offline} messages={block.messages} onToast={onToast} />
        );
      }),
    [blocks, session, selfId, canAdd, offline, onToast],
  );
  const last = entries.at(-1);
  const hasChat = entries.some((entry) => entry.kind === 'chat');
  const mine = last?.kind === 'chat' && last.userId === selfId;
  const lastShown = useRef(last?.id);

  const toBottom = () => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
    stuck.current = true;
    setMissed(false);
  };

  useLayoutEffect(() => {
    if (!active) return;
    const scroll = chatScroll(stuck.current, lastShown.current !== last?.id, mine);
    lastShown.current = last?.id;
    if (scroll === 'bottom') toBottom();
    if (scroll === 'flag') setMissed(true);
    // Keyed on the last line: the list stops growing once it reaches its cap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, active]);

  // A notice shortens the log from below, and the latest line shouldn't go behind it.
  useEffect(() => {
    const element = list.current;
    if (!element || !active) return undefined;
    const observer = new ResizeObserver(() => {
      if (stuck.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  const onScroll = () => {
    const element = list.current;
    if (!element || !active) return;
    stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_PX;
    if (stuck.current) setMissed(false);
  };

  const write = (value: string) => {
    draft.current = value;
    setText(value);
    setSlow(false);
  };

  /** The line in the chat now holds the text, so a refusal can only lose it if that goes too. */
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || offline) return;
    write('');
    const { id, limited } = await session.sendChat(body);
    if (!limited || draft.current.trim()) return; // Their next message has the box.
    session.discardChat(id);
    write(body);
    setSlow(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={list}
          onScroll={onScroll}
          role="log"
          aria-label="Chat messages"
          tabIndex={0}
          className="rail-scroll flex h-full flex-col py-3 outline-offset-[-2px]"
        >
          {spoilers > 0 && !revealed && (
            <p className="mb-3 text-sm text-muted">
              {plural(spoilers, 'message')} from a session you missed.{' '}
              <button type="button" onClick={() => void catchUp(session.slug, () => setRevealed(true))} className="text-link">
                Catch up
              </button>
            </p>
          )}
          {!hasChat &&
            (view.alone ? <p className="mt-auto font-semibold">Only you so far.</p> : <p className="mt-auto text-muted">Nothing said yet.</p>)}
          {lines}
        </div>
        {missed && (
          <button
            type="button"
            onClick={toBottom}
            className="btn btn-sm enter float absolute bottom-2 left-1/2 -translate-x-1/2 text-text"
          >
            <Icon name="down" className="size-3.5" />
            New messages
          </button>
        )}
      </div>

      {toasts}

      <form onSubmit={(event) => void submit(event)} className="rail-edge relative border-t border-line py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <label htmlFor="chat" className="sr-only">
          Message
        </label>
        <div className="flex items-center gap-2">
          <ReactionPicker session={session} disabled={offline} />
          <input
            id="chat"
            value={text}
            maxLength={MAX_LENGTH}
            onChange={(event) => write(event.target.value)}
            placeholder={offline ? 'Reconnecting…' : 'Message'}
            autoComplete="off"
            enterKeyHint="send"
            className="field min-w-0 flex-1"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={offline || empty}
            className={`btn btn-icon disabled:opacity-100 ${empty || offline ? 'text-dim' : 'btn-primary'}`}
          >
            <Icon name="send" className="size-[18px]" />
          </button>
        </div>
        {slow && (
          <p role="status" className="mt-1.5 text-xs text-warn">
            Slow down a little. Your message is still here.
          </p>
        )}
        {text.length >= COUNT_FROM && <p className="mt-1.5 text-right fig text-dim">{MAX_LENGTH - text.length} left</p>}
      </form>
    </div>
  );
};

type LineProps = { session: RoomSession; canAdd: boolean; offline: boolean; onToast: (text: string) => void };

type GroupProps = LineProps & { selfId: string | undefined; messages: ChatLine[] };

/** Runs are rebuilt with every new line, so it's what's in one that counts. */
const sameGroup = ({ messages: a, ...before }: GroupProps, { messages: b, ...after }: GroupProps) =>
  a.length === b.length &&
  a.every((message, index) => message === b[index]) &&
  (Object.keys(before) as (keyof typeof before)[]).every((key) => before[key] === after[key]);

const MessageGroup = memo(({ session, selfId, canAdd, offline, messages, onToast }: GroupProps) => {
  const first = messages[0];
  if (!first) return null;
  const own = first.userId === selfId;
  return (
    <div className="mt-2.5 first:mt-auto">
      {messages.map((message, index) => (
        <Message
          key={message.id}
          session={session}
          canAdd={canAdd}
          offline={offline}
          message={message}
          name={index === 0 ? (own ? 'You' : firstName(first.author)) : undefined}
          onToast={onToast}
        />
      ))}
    </div>
  );
}, sameGroup);

type MessageProps = LineProps & { message: ChatLine; name?: string };

const Message = memo(({ session, canAdd, offline, message, name, onToast }: MessageProps) => {
  const parts = splitLinks(message.body);
  const video = parts.find((part) => part.kind === 'link' && isYouTubeUrl(part.href));
  const [busy, setBusy] = useState(false);

  const add = async (url: string) => {
    setBusy(true);
    try {
      await session.queueAdd({ url }, 'end');
      onToast('Added to the queue');
    } catch (error) {
      toastError(onToast)(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div title={formatClock(message.createdAt)}>
      <p data-delivery={message.delivery} className={`leading-5 transition-opacity [overflow-wrap:anywhere] ${message.delivery ? 'opacity-55' : ''}`}>
        {name && (
          <span style={{ color: hueOf(message.userId) }} className="mr-1.5 inline-block max-w-[90%] truncate align-bottom font-semibold">
            {name}
          </span>
        )}
        {parts.map((part, index) =>
          part.kind === 'link' ? (
            <a key={index} href={part.href} target="_blank" rel="noreferrer noopener" className="text-text underline underline-offset-2">
              {part.text}
            </a>
          ) : (
            part.text
          ),
        )}
      </p>
      {message.delivery === 'failed' && <NotSent session={session} id={String(message.id)} offline={offline} />}
      {video?.kind === 'link' && canAdd && !message.delivery && (
        <button type="button" disabled={busy || offline} onClick={() => void add(video.href)} className="btn btn-quiet btn-sm mt-1 mb-0.5">
          {busy ? <span className="spinner size-3" /> : <Icon name="film" className="size-3.5" />}
          Add to queue
        </button>
      )}
    </div>
  );
});

const NotSent = ({ session, id, offline }: { session: RoomSession; id: string; offline: boolean }) => (
  <p className="mt-1 flex items-center gap-1.5 text-xs text-warn">
    Not sent.
    <button type="button" disabled={offline} onClick={() => session.retryChat(id)} className="btn btn-quiet btn-sm">
      Retry
    </button>
    <button type="button" aria-label="Remove this message" onClick={() => session.discardChat(id)} className="btn btn-ghost btn-sm">
      Remove
    </button>
  </p>
);

/** Unread chat from other people, counted from the last line this viewer saw. */
export const useUnread = (entries: ChatEntry[], selfId: string | undefined, seeing: boolean): number => {
  const seen = useRef<ChatEntry['id'] | null>(null);
  const [, redraw] = useState(0);
  const last = entries.at(-1);

  useEffect(() => {
    if (seeing && last && seen.current !== last.id) {
      seen.current = last.id;
      redraw((count) => count + 1);
    }
  }, [last, seeing]);

  return countUnread(entries, seen.current, selfId);
};
