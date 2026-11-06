import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomSession, RoomView } from '../room/session';
import { avatarColor } from './format';

type Props = { session: RoomSession; view: RoomView };

export const ChatPanel = ({ session, view }: Props) => {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [view.messages.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    session.send('chat.send', { text: body });
    setText('');
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={list} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {view.messages.length === 0 && <p className="pt-8 text-center text-sm text-muted">Say hi. Everyone in the room sees it.</p>}
        {view.messages.map((message) => (
          <p key={message.id} className="text-sm leading-relaxed break-words">
            <span style={{ color: avatarColor(message.userId) }} className="font-semibold">
              {message.author}
            </span>{' '}
            {message.body}
          </p>
        ))}
      </div>

      <form onSubmit={submit} className="border-t border-line p-3">
        <label htmlFor="chat" className="sr-only">
          Message
        </label>
        <input
          id="chat"
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          placeholder="Message the room"
          autoComplete="off"
          className="w-full rounded-xl border border-line bg-raised px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent/60"
        />
      </form>
    </div>
  );
};
