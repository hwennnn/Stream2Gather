import type { ReactNode } from 'react';
import type { Media } from '../../api/http';
import { formatTime } from '../../ui/format';
import { Thumb } from '../../ui/Thumb';

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
