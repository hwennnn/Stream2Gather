import type { RoomView } from '../room/session';
import { Icon } from './Icon';
import { firstName } from './people';
import { Thumb } from './Thumb';

type Props = { view: RoomView; url: string; copied: boolean; onCopy: () => void; onClose?: () => void };

/** The one way to invite: what the friend gets, then the link. Lives at the top of the rail, off the player. */
export const InviteSheet = ({ view, url, copied, onCopy, onClose }: Props) => {
  const video = view.queue[0];
  return (
    <section aria-label="Invite" className="enter rail-edge shrink-0 border-b border-line py-4">
      <p className="mb-2 text-xs text-dim">What friends will see</p>
      <div className="flex items-center gap-3">
        {video && <Thumb src={video.thumbnailUrl} className="w-20 rounded-md" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{firstName(view.self?.name ?? 'A friend')} saved you a seat</p>
          <p className="truncate text-[13px] leading-[18px] text-muted">{video ? `${view.name}, watching ${video.title}` : view.name}</p>
        </div>
        {onClose && (
          <button type="button" aria-label="Close" onClick={onClose} className="btn btn-ghost btn-sm btn-icon self-start">
            <Icon name="close" className="size-4" />
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <p className="fig min-w-0 flex-1 truncate text-muted">{url.replace(/^https?:\/\//, '')}</p>
        <button type="button" onClick={onCopy} className="btn btn-quiet btn-sm">
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </section>
  );
};
