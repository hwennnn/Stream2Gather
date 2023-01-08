import PlayerControl from '@app/components/rooms/PlayerControl';
import {
  startPlayingVideo,
  subscribeStreamEvent
} from '@app/lib/roomSocketService';
import { useRoomSocket } from '@app/pages/room/[slug]';
import useRoomStore, {
  setDuration,
  setPlayedSeconds,
  setPlaying
} from '@app/store/useRoomStore';
import { Box, SlideFade } from '@chakra-ui/react';
import dynamic from 'next/dynamic';
import { FC, useRef, useState } from 'react';
import shallow from 'zustand/shallow';

const ReactPlayer = dynamic(
  async () => await import('@app/components/rooms/ReactPlayerWrapper'),
  {
    ssr: false
  }
);

export const Player: FC = () => {
  const { roomSocket: socket } = useRoomSocket();
  const { playing, isMuted, volume, playingIndex, playlist } = useRoomStore(
    (state) => ({
      playing: state.playing,
      isMuted: state.isMuted,
      volume: state.volume,
      playingIndex: state.playingIndex,
      playlist: state.playlist
    }),
    shallow
  );
  const [isHovered, setIsHovered] = useState(false);

  const playerWrapperRef = useRef<any>();
  const playerRef = useRef<any>();

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
    <Box
      ref={playerWrapperRef}
      position="relative"
      pt={'56.25%'}
      onMouseOver={() => {
        if (isHovered) return;
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        if (!isHovered) return;
        setTimeout(() => {
          setIsHovered(false);
        }, 200);
      }}
    >
      <ReactPlayer
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          userSelect: 'none'
        }}
        width="100%"
        height="100%"
        // onPlay={() => play()}
        // onPause={() => pause()}
        onReady={() => onPlayerReady()}
        onProgress={(callback: any) => updateProgress(callback)}
        onDuration={(duration: number) => updateDuration(duration)}
        muted={isMuted}
        playing={playing}
        volume={volume / 100}
        url={playlist[playingIndex].url}
        config={{
          youtube: {
            playerVars: {
              cc_load_policy: 0,
              iv_load_policy: 3,
              showinfo: 0,
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              rel: 0,
              fs: 0,
              hl: 'eng'
            }
          }
        }}
        playerref={playerRef}
      />

      <SlideFade in={isHovered || !playing} offsetY="20px">
        <Box
          px="4"
          w="full"
          position={'absolute'}
          left={0}
          bottom={0}
          right={0}
          style={{ backgroundColor: 'rgba(1,1,1,0.005)' }}
        >
          <PlayerControl
            playerRef={playerRef}
            playerWrapperRef={playerWrapperRef}
          />
        </Box>
      </SlideFade>
    </Box>
  );
};
