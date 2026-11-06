import { useEffect, useState } from 'react';
import { Page } from '../ui/Page';
import { firstName, listNames } from '../ui/people';
import { Thumb } from '../ui/Thumb';
import { recapApi, type PublicRecap } from './api';
import { DISCLOSURE, EmojiCounts, nightOf, plural, position, together, totalOf, whoReacted } from './words';

const Video = ({ video }: { video: PublicRecap['videos'][number] }) => (
  <li className="flex items-center gap-3 py-2 text-sm">
    <Thumb src={video.thumbnailUrl ?? ''} className="w-20 rounded-md" />
    {video.title ? (
      <a href={video.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline underline-offset-2">
        {video.title}
      </a>
    ) : (
      <span className="min-w-0 flex-1 truncate text-muted">Video unavailable</span>
    )}
  </li>
);

/** What a crew chose to show the world. No player here, and never any chat. */
export default function SharedRecap({ token }: { token: string }) {
  const [recap, setRecap] = useState<PublicRecap | null | 'gone'>(null);

  useEffect(() => {
    let live = true;
    recapApi.shared(token).then(
      (read) => live && setRecap(read),
      () => live && setRecap('gone'),
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (!recap) return null;
  if (recap === 'gone') {
    return (
      <Page status>
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em]">This recap isn’t shared</h1>
        <p className="mt-1.5 text-muted">Whoever shared it has taken it back. That night stays with the people who were there.</p>
        <a href="/" className="btn btn-primary mt-5">
          Start your own room
        </a>
      </Page>
    );
  }

  const reactions = totalOf(recap.reactions);
  const names = recap.people.map(firstName);
  return (
    <Page>
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em]">
        {nightOf(recap.startedAt)} with {recap.crewName}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {listNames(names)} watched together for <span className="tabular-nums">{together(recap.wallMs)}</span>.
      </p>
      <ol className="mt-4 divide-y divide-line border-y border-line">
        {recap.videos.map((video, index) => (
          <Video key={index} video={video} />
        ))}
      </ol>
      {recap.biggest && (
        <div className="night-moment text-sm">
          <p className="text-muted">
            {whoReacted(recap.biggest.people, recap.people.length, false)} at <span className="tabular-nums">{position(recap.biggest.posMs)}</span> in {recap.biggest.title || 'Video unavailable'}
          </p>
          <p className="mt-1">
            <EmojiCounts counts={recap.biggest.emojis} />
          </p>
        </div>
      )}
      {reactions > 0 && <p className="mt-3 text-[13px] text-dim">{plural(reactions, 'reaction')}</p>}
      <p className="mt-6 text-[15px] font-medium">Save your friends a seat.</p>
      <a href="/" className="btn btn-primary mt-2">
        Start your own room
      </a>
      <p className="mt-6 text-xs text-dim">{DISCLOSURE}</p>
    </Page>
  );
}
