import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../api/http';
import type { ChatEntry, RoomSession, RoomView } from '../room/session';
import { Avatar } from './Avatar';
import { avatarColor, formatClock, isYouTubeUrl, splitLinks } from './format';
import { Icon } from './Icon';
import { ReactionLane, ReactionPicker } from './Reactions';
import { canQueue, chatScroll, countUnread, isOffline } from './rules';
import { toastError } from './Toasts';
import { PHONE_LANDSCAPE, useMediaQuery } from './useMediaQuery';

const STICK_PX = 80;
const GROUP_GAP_MS = 5 * 60_000;
const COUNT_FROM = 450;
const MAX_LENGTH = 500;

type Props = {
  session: RoomSession;
  view: RoomView;
  active: boolean;
  inviteUrl: string;
  onCopyInvite: () => void;
  onToast: (text: string) => void;
};

type Block = { kind: 'system'; entry: Extract<ChatEntry, { kind: 'system' }> } | { kind: 'chat'; messages: ChatMessage[] };

const toBlocks = (entries: ChatEntry[]): Block[] => {
  const blocks: Block[] = [];
  for (const entry of entries) {
    if (entry.kind === 'system') {
      blocks.push({ kind: 'system', entry });
      continue;
    }
    const last = blocks.at(-1);
    const previous = last?.kind === 'chat' ? last.messages.at(-1) : undefined;
    const sameRun =
      previous?.userId === entry.userId && Date.parse(entry.createdAt) - Date.parse(previous.createdAt) < GROUP_GAP_MS;
    if (sameRun && last?.kind === 'chat') last.messages.push(entry);
    else blocks.push({ kind: 'chat', messages: [entry] });
  }
  return blocks;
};

export const ChatPanel = ({ session, view, active, inviteUrl, onCopyInvite, onToast }: Props) => {
  const [text, setText] = useState('');
  const [missed, setMissed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const sending = useRef(false);
  const offline = isOffline(view);
  const entries = view.messages;
  const empty = text.trim().length === 0;
  const sideways = useMediaQuery(PHONE_LANDSCAPE); // There's no bar under the player then.

  const blocks = useMemo(() => toBlocks(entries), [entries]);
  const last = entries.at(-1);
  const hasChat = entries.some((entry) => entry.kind === 'chat');
  const mine = last?.kind === 'chat' && last.userId === view.self?.userId;
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

  const onScroll = () => {
    const element = list.current;
    if (!element || !active) return;
    stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_PX;
    if (stuck.current) setMissed(false);
  };

  /** The draft stays until the server has the message, so a refusal loses nothing. */
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || offline || sending.current) return;
    sending.current = true;
    try {
      await session.request('chat.send', { text: body });
      setText((draft) => (draft.trim() === body ? '' : draft));
    } catch (error) {
      toastError(onToast)(error);
    } finally {
      sending.current = false;
    }
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
          className="h-full overflow-y-auto px-3 py-3 outline-offset-[-2px]"
        >
          {!hasChat &&
            (view.alone ? (
              <InviteCard url={inviteUrl} onCopy={onCopyInvite} />
            ) : (
              <p className="py-6 text-center text-sm text-muted">Say hi. Everyone in the room sees it.</p>
            ))}
          {blocks.map((block) =>
            block.kind === 'system' ? (
              <p key={block.entry.id} className="my-2 px-2 text-center text-xs leading-snug text-muted">
                {block.entry.text}
              </p>
            ) : (
              <MessageGroup key={block.messages[0]?.id} session={session} view={view} messages={block.messages} onToast={onToast} />
            ),
          )}
        </div>
        {missed && (
          <button
            type="button"
            onClick={toBottom}
            className="btn btn-sm enter absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-text font-semibold text-ink shadow-xl"
          >
            <Icon name="down" className="size-3.5" />
            New messages
          </button>
        )}
      </div>

      <form onSubmit={(event) => void submit(event)} className="relative border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {sideways && (
          <div className="absolute inset-x-0 bottom-full h-14">
            <ReactionLane reactions={view.reactions} />
          </div>
        )}
        <label htmlFor="chat" className="sr-only">
          Message
        </label>
        <div className="flex items-center gap-2">
          <ReactionPicker session={session} disabled={offline} />
          <input
            id="chat"
            value={text}
            maxLength={MAX_LENGTH}
            onChange={(event) => setText(event.target.value)}
            placeholder={offline ? 'Reconnecting…' : 'Message the room'}
            autoComplete="off"
            enterKeyHint="send"
            className="field min-w-0 flex-1"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={offline || empty}
            className={`btn btn-icon size-11 rounded-xl disabled:opacity-100 ${empty || offline ? 'bg-white/[0.06] text-muted' : 'btn-primary'}`}
          >
            <Icon name="send" className="size-[18px]" />
          </button>
        </div>
        {text.length >= COUNT_FROM && <p className="mt-1.5 text-right text-xs text-muted">{MAX_LENGTH - text.length} left</p>}
      </form>
    </div>
  );
};

const InviteCard = ({ url, onCopy }: { url: string; onCopy: () => void }) => (
  <div className="enter m-1 rounded-2xl border border-line bg-white/[0.03] p-4">
    <p className="text-[15px] leading-snug font-semibold text-balance">Just you so far. Send this link to watch together.</p>
    <p className="mt-3 truncate rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-muted">{url}</p>
    <button type="button" onClick={onCopy} className="btn btn-primary mt-3 w-full">
      <Icon name="link" />
      Copy link
    </button>
  </div>
);

type GroupProps = { session: RoomSession; view: RoomView; messages: ChatMessage[]; onToast: (text: string) => void };

const MessageGroup = ({ session, view, messages, onToast }: GroupProps) => {
  const first = messages[0];
  if (!first) return null;
  const own = first.userId === view.self?.userId;
  const member = view.members.find((person) => person.userId === first.userId);
  return (
    <div className="mt-3 flex gap-2.5 first:mt-0">
      <Avatar person={{ userId: first.userId, name: first.author, avatarUrl: member?.avatarUrl }} className="mt-0.5 size-7 text-[11px] ring-panel!" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 text-[13px] leading-5">
          <span style={{ color: avatarColor(first.userId) }} className="min-w-0 truncate font-semibold">
            {first.author}
          </span>
          {own && <span className="shrink-0 text-xs text-muted">(you)</span>}
          <time dateTime={first.createdAt} className="hidden shrink-0 text-[11px] text-muted [@media(hover:none)]:inline">
            {formatClock(first.createdAt)}
          </time>
        </p>
        {messages.map((message) => (
          <Message key={message.id} session={session} view={view} message={message} onToast={onToast} />
        ))}
      </div>
    </div>
  );
};

type MessageProps = { session: RoomSession; view: RoomView; message: ChatMessage; onToast: (text: string) => void };

const Message = ({ session, view, message, onToast }: MessageProps) => {
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
    <div className="group/message relative pr-14">
      <p className="text-sm leading-[1.45] [overflow-wrap:anywhere]">
        {parts.map((part, index) =>
          part.kind === 'link' ? (
            <a key={index} href={part.href} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2 hover:brightness-125">
              {part.text}
            </a>
          ) : (
            part.text
          ),
        )}
      </p>
      {video?.kind === 'link' && canQueue(view) && (
        <button type="button" disabled={busy || isOffline(view)} onClick={() => void add(video.href)} className="btn btn-quiet btn-sm mt-1 mb-0.5">
          {busy ? <span className="spinner size-3" /> : <Icon name="film" className="size-3.5" />}
          Add to queue
        </button>
      )}
      <time
        dateTime={message.createdAt}
        className="absolute top-0.5 right-0 text-[11px] text-muted opacity-0 transition-opacity group-hover/message:opacity-100"
      >
        {formatClock(message.createdAt)}
      </time>
    </div>
  );
};

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
