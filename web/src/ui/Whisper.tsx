import { useEffect, useRef, useState } from 'react';
import type { ChatEntry, ChatLine } from '../room/session';
import { firstName, hueOf } from './people';

const WHISPER_MS = 6000;

const isFriend = (selfId: string | undefined) => (entry: ChatEntry): entry is ChatLine => entry.kind === 'chat' && entry.userId !== selfId && !entry.missed;

/** Theatre mode has no chat to read, so what a friend says is leaned over and said once, beside the controls. */
export const Whisper = ({ messages, selfId }: { messages: ChatEntry[]; selfId: string | undefined }) => {
  const last = messages.findLast(isFriend(selfId));
  const [shown, setShown] = useState<ChatLine | null>(null);
  const heard = useRef(last?.id);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!last || last.id === heard.current) return;
    heard.current = last.id;
    setShown(last);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(null), WHISPER_MS);
  }, [last]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!shown) return null;
  return (
    <p key={shown.id} role="status" title={shown.body} className="enter min-w-0 flex-[0_1_24rem] truncate text-[13px]">
      <span style={{ color: hueOf(shown.userId) }} className="mr-1.5 font-semibold">
        {firstName(shown.author)}
      </span>
      {shown.body}
    </p>
  );
};
