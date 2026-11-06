import { useState, type FormEvent } from 'react';
import { EMOJI } from '../ui/Reactions';

type Props = { onSend: (part: { emoji?: string; body?: string }) => void; problem: boolean };

/** The room's six reactions and a line of chat, left at this point in the video. */
export const Compose = ({ onSend, problem }: Props) => {
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    onSend({ body });
    setText('');
  };

  return (
    <div className="mt-3">
      <div className="flex justify-between">
        {EMOJI.map((emoji) => (
          <button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => onSend({ emoji })} className="react flex size-9 cursor-pointer items-center justify-center rounded-md text-[20px]">
            {emoji}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-2">
        <label htmlFor="catchup-chat" className="sr-only">
          Say something at this moment
        </label>
        <input id="catchup-chat" value={text} maxLength={500} onChange={(event) => setText(event.target.value)} placeholder="Message" className="field w-full" />
      </form>
      {problem && (
        <p role="status" className="mt-1 text-sm text-warn">
          That didn’t save. Try again.
        </p>
      )}
    </div>
  );
};
