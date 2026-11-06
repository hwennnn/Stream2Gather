import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';

/** The two columns a page can have. A sideways phone is short, so a narrow page spreads out there. */
export const NARROW_COLUMN = 'mx-auto w-full max-w-xl px-6 phone:px-4 land:max-w-[1160px]';
export const WIDE_COLUMN = 'mx-auto w-full max-w-[1160px] px-6 phone:px-4';

/** The room's bar, for every other page: the same height, and the mark at the same x. */
export const SiteHeader = ({ children }: { children?: ReactNode }) => (
  <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4 phone:h-14 land:h-10">
    <a href="/" aria-label="Stream2Gather home">
      <Wordmark />
    </a>
    {children}
  </header>
);

/** The frame for every page that isn't the room or the landing. */
export const Page = ({ children, status }: { children: ReactNode; status?: boolean }) => (
  <div className="flex min-h-full flex-col">
    <SiteHeader />
    <main role={status ? 'status' : undefined} className={`${NARROW_COLUMN} flex-1 pt-[12vh] pb-10 phone:pt-6 land:pt-4`}>
      {children}
    </main>
  </div>
);
