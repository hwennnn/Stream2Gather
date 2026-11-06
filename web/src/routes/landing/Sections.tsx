import type { ReactNode } from 'react';
import type { Media } from '../../api/http';
import { formatTime } from '../../ui/format';
import { Thumb } from '../../ui/Thumb';

const PICKS = 8;
const REPO = 'https://github.com/hwennnn/Stream2Gather';

const Heading = ({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) => (
  <div className="max-w-2xl">
    <p className="text-gradient text-sm font-semibold">{eyebrow}</p>
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
          ? items.slice(0, PICKS).map((media) => (
              <li key={media.sourceId} className="min-w-0">
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
              <li key={index} aria-hidden="true">
                <div className="skeleton aspect-video rounded-xl" />
                <div className="skeleton mt-2.5 h-3.5 w-4/5 rounded" />
                <div className="skeleton mt-2 h-3 w-1/2 rounded" />
              </li>
            ))}
      </ul>
    </section>
  );
};

const STEPS = [
  { title: 'Paste a video', text: 'Drop in a YouTube link, or open an empty room and search from there.' },
  { title: 'Send the link', text: 'Your link is copied for you. Friends open it and join, with nothing to install.' },
  { title: 'Press play', text: 'Play, pause and seek once, and it happens on every screen in the room.' },
];

export const HowItWorks = () => (
  <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-14 phone:py-10">
    <Heading id="how-title" eyebrow="How it works" title="From link to movie night in seconds." />
    <ol className="mt-8 grid gap-4 md:grid-cols-3">
      {STEPS.map((step, index) => (
        <li key={step.title} className="rounded-2xl border border-line bg-panel/60 p-6">
          <span className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-sky to-violet text-sm font-bold text-ink">
            {index + 1}
          </span>
          <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{step.text}</p>
        </li>
      ))}
    </ol>
  </section>
);

const Tile = ({ title, text, className = '', children }: { title: string; text: string; className?: string; children?: ReactNode }) => (
  <li className={`flex flex-col justify-between gap-5 overflow-hidden rounded-2xl border border-line bg-panel/60 p-6 ${className}`}>
    {children && <div aria-hidden="true">{children}</div>}
    <div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{text}</p>
    </div>
  </li>
);

const VIEWERS = [
  { name: 'Your laptop', color: '#8fa8ff' },
  { name: 'Sam’s phone', color: '#5eead4' },
  { name: 'Priya’s TV', color: '#f0abfc' },
];

const SyncLanes = () => (
  <div className="relative space-y-3 py-1">
    {VIEWERS.map((viewer) => (
      <div key={viewer.name} className="flex items-center gap-3">
        <span className="w-24 shrink-0 truncate text-xs text-muted">{viewer.name}</span>
        <span className="h-1.5 flex-1 rounded-full bg-white/10">
          <span className="block h-full w-[62%] rounded-full" style={{ background: viewer.color }} />
        </span>
      </div>
    ))}
    <span className="absolute inset-y-0 left-[calc(6.75rem+(100%-6.75rem)*0.62)] w-px bg-text/50" />
  </div>
);

const QUEUE = ['Trailer first', 'The main event', 'One more, then bed'];

const QueueStack = () => (
  <ul className="space-y-1.5">
    {QUEUE.map((title, index) => (
      <li key={title} className="flex items-center gap-2.5 rounded-lg bg-raised/70 px-2.5 py-2 text-[13px]">
        <span className="w-3 text-xs text-muted tabular-nums">{index + 1}</span>
        <span className="truncate">{title}</span>
      </li>
    ))}
  </ul>
);

const Reactions = () => (
  <div className="flex gap-2 text-2xl">
    {['😂', '❤️', '🔥', '😮', '👏'].map((emoji) => (
      <span key={emoji} className="flex size-11 items-center justify-center rounded-xl bg-raised/70">
        {emoji}
      </span>
    ))}
  </div>
);

const LockSwitch = () => (
  <div className="flex items-center justify-between rounded-xl bg-raised/70 px-3.5 py-3 text-[13px]">
    Only I can control playback and the queue
    <span className="ml-3 flex h-5 w-9 shrink-0 items-center justify-end rounded-full bg-linear-to-r from-sky to-violet p-0.5">
      <span className="size-4 rounded-full bg-ink" />
    </span>
  </div>
);

const GuestPass = () => (
  <div className="flex items-center gap-3 rounded-xl bg-raised/70 px-3.5 py-3 text-[13px]">
    <span className="text-muted">Joining as</span>
    <span className="rounded-md border border-line bg-ink/50 px-2 py-1 font-medium">Cozy Sparrow</span>
    <span className="btn btn-primary btn-sm ml-auto">Join</span>
  </div>
);

const Screens = () => (
  <div className="flex h-[46px] items-end gap-3">
    <span className="h-11 w-[4.6rem] rounded-md border-2 border-accent/60 bg-raised/70" />
    <span className="h-9 w-14 rounded-md border-2 border-violet/60 bg-raised/70" />
    <span className="h-10 w-6 rounded-md border-2 border-sky/60 bg-raised/70" />
  </div>
);

export const Features = () => (
  <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-14 phone:py-10">
    <Heading id="features-title" eyebrow="Built for watching together" title="Everything a watch party needs." />
    <ul className="mt-8 grid gap-4 md:grid-cols-6">
      <Tile
        className="md:col-span-4"
        title="Everyone on the same moment"
        text="Each viewer quietly corrects itself, so a slow connection catches up without pausing the room."
      >
        <SyncLanes />
      </Tile>
      <Tile className="md:col-span-2" title="One shared queue" text="Anyone can add, reorder and play next.">
        <QueueStack />
      </Tile>
      <Tile className="md:col-span-3" title="Chat beside the video" text="Talk and react without covering what you’re watching.">
        <Reactions />
      </Tile>
      <Tile className="md:col-span-3" title="You choose who drives" text="Keep it open to everyone, or lock playback and the queue to yourself.">
        <LockSwitch />
      </Tile>
      <Tile className="md:col-span-3" title="No accounts required" text="Guests join from a link. Sign in only if you want to keep your name.">
        <GuestPass />
      </Tile>
      <Tile className="md:col-span-3" title="Works on your phone" text="Rooms fit phones, tablets and big screens, with theatre and fullscreen when you want them.">
        <Screens />
      </Tile>
    </ul>
  </section>
);

export const Closing = ({ disabled, onStart }: { disabled: boolean; onStart: () => void }) => (
  <section className="mx-auto max-w-6xl px-6 pt-10 pb-20 phone:pb-12">
    <div className="closing relative overflow-hidden rounded-3xl border border-line px-6 py-14 text-center">
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Your friends are one link away.</h2>
      <p className="mt-3 text-muted">Start a room now. It takes one paste.</p>
      <button type="button" disabled={disabled} onClick={onStart} className="btn btn-primary mt-7 h-12 rounded-xl px-6 text-[15px]">
        Pick a video
      </button>
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
