import dynamic from 'next/dynamic';
import { FC, useRef } from 'react';
import shallow from 'zustand/shallow';
import {
  startPlayingVideo,
  subscribeStreamEvent
} from '../../../lib/roomSocketService';
import { useRoomSocket } from '../../../pages/room';
import useRoomStore, {
  setDuration,
  setPlayedSeconds,
  setPlaying
} from '../../../store/useRoomStore';
import PlayerControl from './PlayerControl';

const ReactPlayer = dynamic(async () => await import('./ReactPlayerWrapper'), {
  ssr: false
});

export const Player: FC = () => {
  const { roomSocket: socket } = useRoomSocket();
  const { playing, isMuted, playingIndex, playlist } = useRoomStore(
    (state) => ({
      playing: state.playing,
      isMuted: state.isMuted,
      playingIndex: state.playingIndex,
      playlist: state.playlist
    }),
    shallow
  );

  const playerRef = useRef<any>();
  const progressBarRef = useRef<any>();

  const onPlayerReady = (): void => {
    // subscribe to streaming events
    subscribeStreamEvent(socket, playerRef);
    initialisePlayer();
  };

  const initialisePlayer = (): void => {
    // Getting non-reactive values from the store
    const { playedSeconds, playedTimestampUpdatedAt } = useRoomStore.getState();

    const shouldStartPlaying = !playing && playedTimestampUpdatedAt === '0';

    if (playing) {
      const currentTimestamp =
        playedSeconds +
        (playedTimestampUpdatedAt === '0'
          ? 0
          : (Date.now() - Number.parseInt(playedTimestampUpdatedAt)) / 1000);

      setPlaying(true);
      playerRef.current.seekTo(currentTimestamp, 'seconds');
    } else if (shouldStartPlaying) {
      startPlayingVideo(socket);
      setPlaying(true);
      playerRef.current.seekTo(playedSeconds, 'seconds');
    } else {
      setPlaying(false);
      playerRef.current.seekTo(playedSeconds, 'seconds');
    }
  };

  const updateProgress = ({
    playedSeconds
  }: {
    playedSeconds: number;
  }): void => {
    setPlayedSeconds(playedSeconds);
  };

  const updateDuration = (duration: number): void => {
    setDuration(duration);
  };

  return (
    <div className="w-full tablet:w-3/4">
      <div className="relative pt-[56.25%]">
        <ReactPlayer
          className="absolute top-0 left-0"
          width="100%"
          height="100%"
          // onPlay={() => play()}
          // onPause={() => pause()}
          onReady={() => onPlayerReady()}
          onProgress={(callback: any) => updateProgress(callback)}
          onDuration={(duration: number) => updateDuration(duration)}
          muted={isMuted}
          playing={playing}
          url={playlist[playingIndex].url}
          config={{
            youtube: {
              playerVars: {
                showinfo: 0,
                controls: 0,
                disablekb: 1,
                modestbranding: 1,
                rel: 0
              }
            }
          }}
          playerref={playerRef}
        />
      </div>
      <PlayerControl playerRef={playerRef} progressBarRef={progressBarRef} />
    </div>
  );
};
