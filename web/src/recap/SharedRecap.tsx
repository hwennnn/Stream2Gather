import { useEffect, useState } from 'react';
import { Page } from '../ui/Page';
import { listNames } from '../ui/people';
import { recapApi, type PublicRecap } from './api';
import { DISCLOSURE, EmojiCounts, plural, position, together, totalOf } from './words';

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

const Video = ({ video }: { video: PublicRecap['videos'][number] }) => (
  <li className="truncate py-2 text-sm">
    {video.title ? (
      <a href={video.url} target="_blank" rel="noreferrer" className="text-link">
        {video.title}
      </a>
    ) : (
      <span className="text-muted">Video unavailable</span>
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
        <h1 className="text-xl font-semibold">This recap isn’t shared</h1>
        <a href="/" className="btn btn-primary mt-6">
          Start your own room
        </a>
      </Page>
    );
  }

  const reactions = totalOf(recap.reactions);
  return (
    <Page>
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em]">{recap.crewName}</h1>
      <p className="mt-1 text-sm text-muted">
        {listNames(recap.people)} watched together on {DAY.format(Date.parse(recap.startedAt))}, for <span className="fig text-[13px]">{together(recap.wallMs)}</span>.
      </p>
      <ol className="mt-4 divide-y divide-line border-y border-line">
        {recap.videos.map((video, index) => (
          <Video key={index} video={video} />
        ))}
      </ol>
      {reactions > 0 && <p className="mt-4 text-sm text-muted">{plural(reactions, 'reaction')}</p>}
      {recap.biggest && (
        <div className="mt-4 text-sm">
          <p className="text-muted">
            Biggest moment, <span className="fig text-[13px]">{position(recap.biggest.posMs)}</span> in {recap.biggest.title || 'Video unavailable'}
          </p>
          <p className="mt-0.5">
            <EmojiCounts counts={recap.biggest.emojis} />
          </p>
        </div>
      )}
      <a href="/" className="btn btn-primary mt-6">
        Start your own room
      </a>
      <p className="mt-6 text-xs text-dim">{DISCLOSURE}</p>
    </Page>
  );
}
