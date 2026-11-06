import type { ReactNode } from 'react';
import type { Media } from '../../api/http';
import { formatTime } from '../../ui/format';
import { Thumb } from '../../ui/Thumb';
import { CHAT } from './HeroPreview';

const PICKS = 8;
/** Fills two or three columns evenly. Only the four-column grid has room for all of them. */
const NARROW_PICKS = 6;
const REPO = 'https://github.com/hwennnn/Stream2Gather';

const pickClass = (index: number) => (index < NARROW_PICKS ? 'min-w-0' : 'min-w-0 max-lg:hidden');

const Heading = ({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) => (
  <div className="max-w-2xl">
    <p className="text-accent text-sm font-semibold">{eyebrow}</p>
    <h2 id={id} className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
      {title}
    </h2>
    {children && <p className="mt-3 text-pretty text-muted">{children}</p>}
  </div>
);

type TrendingProps = { items: Media[] | null; busy: string | null; disabled: boolean; onPick: (media: Media) => void };

export const Trending = ({ items, busy, disabled, onPick }: TrendingProps) => {
  if (items?.length === 0) return null;
  return (
    <section id="trending" aria-labelledby="trending-title" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-14 phone:py-10">
      <Heading id="trending-title" eyebrow="Trending now" title="Not sure what to watch?">
        Pick one and your room opens with it already playing.
      </Heading>
      <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
        {items
          ? items.slice(0, PICKS).map((media, index) => (
              <li key={media.sourceId} className={pickClass(index)}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(media)}
                  className="group block w-full cursor-pointer text-left disabled:cursor-default"
                >
                  <span className="relative block overflow-hidden rounded-xl ring-1 ring-line transition group-hover:ring-accent/60">
                    <Thumb src={media.thumbnailUrl} className="w-full transition duration-300 group-hover:scale-[1.04]" />
                    {media.durationMs > 0 && (
                      <span className="absolute right-1.5 bottom-1.5 rounded-md bg-ink/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                        {formatTime(media.durationMs / 1000)}
                      </span>
                    )}
                    <span
                      className={`absolute inset-0 flex items-center justify-center bg-ink/50 transition ${
                        busy === media.sourceId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                      }`}
                    >
                      {busy === media.sourceId ? <span className="spinner" /> : <span className="btn btn-primary btn-sm">Watch together</span>}
                    </span>
                  </span>
                  <span className="mt-2.5 line-clamp-2 text-sm leading-snug font-medium">{media.title}</span>
                  <span className="mt-1 block truncate text-[13px] text-muted">{media.author}</span>
                </button>
              </li>
            ))
          : Array.from({ length: PICKS }, (_, index) => (
              <li key={index} aria-hidden="true" className={pickClass(index)}>
                <div className="skeleton aspect-video rounded-xl" />
                <div className="skeleton mt-2.5 h-3.5 w-4/5 rounded" />
                <div className="skeleton mt-2 h-3 w-1/2 rounded" />
              </li>
            ))}
      </ul>
    </section>
  );
};

const Tile = ({ title, text, children }: { title: string; text: string; children: ReactNode }) => (
  <li className="room-tile flex flex-col gap-5 overflow-hidden rounded-2xl border border-line p-5">
    <div aria-hidden="true" className="flex-1 select-none">
      {children}
    </div>
    <div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">{text}</p>
    </div>
  </li>
);

const SAMPLE_QUEUE = ['Trailer first', 'The main event', 'One more, then bed'];

/** The videos after the one in the hero, so the picture shows what's on today. */
const QueueStack = ({ items }: { items: Media[] | null }) => {
  const picks = items?.slice(1, 4) ?? [];
  const rows =
    picks.length === SAMPLE_QUEUE.length
      ? picks.map((media) => ({ title: media.title, thumbnail: media.thumbnailUrl }))
      : SAMPLE_QUEUE.map((title) => ({ title, thumbnail: '' }));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.title} className="flex items-center gap-3 rounded-xl bg-raised/70 p-1.5 pr-3 text-[13px]">
          <Thumb src={row.thumbnail} className="w-16 rounded-lg" />
          <span className="line-clamp-2 leading-snug">{row.title}</span>
        </li>
      ))}
    </ul>
  );
};

const ChatStack = () => (
  <div className="flex h-full flex-col gap-2">
    {CHAT.map((message) => (
      <p key={message.name} className="rounded-xl bg-raised/70 px-3 py-2 text-[13px] leading-snug">
        <span style={{ color: message.color }} className="font-semibold">
          {message.name}
        </span>{' '}
        <span className="text-muted">{message.text}</span>
      </p>
    ))}
    <div className="mt-auto flex gap-1.5 text-xl">
      {['😂', '❤️', '🔥', '😮'].map((emoji) => (
        <span key={emoji} className="flex size-9 items-center justify-center rounded-xl bg-raised/70">
          {emoji}
        </span>
      ))}
    </div>
  </div>
);

const HostControls = () => (
  <div className="space-y-2 text-[13px]">
    <div className="flex items-center justify-between rounded-xl bg-raised/70 px-3 py-2.5">
      Only I control playback
      <span className="ml-3 flex h-5 w-9 shrink-0 items-center justify-end rounded-full bg-linear-to-r from-sky to-violet p-0.5">
        <span className="size-4 rounded-full bg-ink" />
      </span>
    </div>
    {CHAT.slice(0, 2).map((person, index) => (
      <div key={person.name} className="flex items-center gap-2.5 rounded-xl bg-raised/70 px-3 py-2">
        <span
          style={{ background: person.color }}
          className="flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-ink"
        >
          {person.name[0]}
        </span>
        {person.name}
        {index === 0 && <span className="ml-auto text-xs font-medium text-accent">Host</span>}
      </div>
    ))}
  </div>
);

export const InsideARoom = ({ items }: { items: Media[] | null }) => (
  <section id="room" aria-labelledby="room-title" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-14 phone:py-10">
    <Heading id="room-title" eyebrow="Inside a room" title="Everything sits beside the video." />
    <ul className="mt-8 grid gap-4 md:grid-cols-3">
      <Tile title="One shared queue" text="Anyone can add and reorder what plays next.">
        <QueueStack items={items} />
      </Tile>
      <Tile title="Chat and reactions" text="Talk without covering what you’re watching.">
        <ChatStack />
      </Tile>
      <Tile title="You choose who drives" text="Leave it open, or keep playback and the queue to yourself.">
        <HostControls />
      </Tile>
    </ul>
  </section>
);

const STEPS = [
  { title: 'Paste a video', text: 'Drop in a YouTube link, or open an empty room and search there.' },
  { title: 'Send the link', text: 'It’s copied for you. Friends open it and join, with nothing to install.' },
  { title: 'Watch together', text: 'Everyone follows one player, with the queue and chat beside it.' },
];

export const HowItWorks = ({ disabled, onStart }: { disabled: boolean; onStart: () => void }) => (
  <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-6 pb-20 phone:pb-12">
    <div className="closing flex flex-wrap items-end justify-between gap-x-6 gap-y-8 rounded-3xl border border-accent/25 p-8 lg:p-12 phone:p-6">
      <div>
        <p className="text-sm font-semibold text-sky">How it works</p>
        <h2 id="how-title" className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Three steps, no sign-up.
        </h2>
      </div>
      <button type="button" disabled={disabled} onClick={onStart} className="btn btn-primary h-12 rounded-xl px-6 text-[15px] phone:order-last phone:w-full">
        Pick a video
      </button>
      <ol className="grid w-full gap-6 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-sky to-violet text-sm font-bold text-ink">
              {index + 1}
            </span>
            <div>
              <h3 className="text-lg leading-9 font-semibold">{step.title}</h3>
              <p className="text-[15px] leading-relaxed text-pretty text-text/80">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  </section>
);

export const Footer = () => (
  <footer className="border-t border-line">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-7 text-sm text-muted">
      <span className="flex items-center gap-2 font-medium text-text">
        <img src="/favicon.svg" alt="" className="size-5" />
        Stream2Gather
      </span>
      <span>Videos play through YouTube’s official player.</span>
      <a href={REPO} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-text hover:underline sm:ml-auto">
        GitHub
      </a>
    </div>
  </footer>
);
