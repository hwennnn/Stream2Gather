import { useEffect, useRef, useState } from 'react';
import { account, useAccount } from '../auth/account';
import { Avatar } from './Avatar';

const ITEM = 'block w-full cursor-pointer rounded-md px-3 py-2 text-left text-[13px] transition-colors hover:bg-raised';

/** `onOpen` lets the room make space first: the menu must not open over the player. */
export const AccountMenu = ({ onOpen }: { onOpen?: () => void }) => {
  const { user, publishableKey, problem } = useAccount();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent | KeyboardEvent) => {
      const outside = event instanceof PointerEvent && !menu.current?.contains(event.target as Node);
      if (outside || (event instanceof KeyboardEvent && event.key === 'Escape')) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!publishableKey) return null;

  if (!user?.signedIn) {
    return (
      <button
        type="button"
        onClick={() => account.signIn()}
        title={problem ?? undefined}
        className="btn btn-ghost"
      >
        {problem ? 'Sign-in unavailable' : 'Sign in'}
      </button>
    );
  }

  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className="flex cursor-pointer rounded-full"
      >
        <Avatar person={{ userId: user.id, name: user.name, avatarUrl: user.avatarUrl }} labelled={false} />
      </button>
      {open && (
        <div role="menu" className="account-menu float absolute top-full right-0 z-30 mt-2 w-52 p-1.5">
          <p className="truncate px-3 py-2 font-semibold">{user.name}</p>
          <button type="button" role="menuitem" className={ITEM} onClick={() => { setOpen(false); account.manage(); }}>
            Manage account
          </button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => { setOpen(false); void account.signOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};
