import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';

/** The frame for every page that isn't the room or the landing. */
export const Page = ({ children, status }: { children: ReactNode; status?: boolean }) => (
  <div className="flex min-h-full flex-col">
    <header className="h-14 shrink-0 border-b border-line">
      <div className="mx-auto flex h-full max-w-[440px] items-center px-6 phone:px-4 land:max-w-3xl">
        <a href="/" aria-label="Stream2Gather home">
          <Wordmark />
        </a>
      </div>
    </header>
    <main role={status ? 'status' : undefined} className="mx-auto w-full max-w-[440px] flex-1 px-6 pt-[12vh] pb-10 phone:px-4 phone:pt-6 land:max-w-3xl land:pt-4">
      {children}
    </main>
  </div>
);
