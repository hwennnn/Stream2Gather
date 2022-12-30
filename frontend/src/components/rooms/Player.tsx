import dynamic from 'next/dynamic';
import { FC, useRef } from 'react';
import {
  BsFullscreen,
  BsPause,
  BsPlay,
  BsVolumeMute,
  BsVolumeUp
} from 'react-icons/bs';
import screenfull from 'screenfull';
import shallow from 'zustand/shallow';
import {
  REQ_STREAMING_EVENTS,
  RES_STREAMING_EVENTS
} from '../../constants/socket';
import { useRoomSocket } from '../../contexts/RoomSocketContext';
import { getFormattedTime } from '../../helpers/time-helper';
import useRoomStore, {
  setDuration,
  setIsMuted,
  setPlayedSeconds,
  setPlaying
} from '../../store/useRoomStore';

interface Props {
  roomId: string | string[] | undefined;
}

const ReactPlayer = dynamic(
  async () => await import('../../components/rooms/ReactPlayerWrapper'),
  {
    ssr: false
  }
);

export const Player: FC<Props> = ({ roomId }) => {
  const { roomSocket: socket } = useRoomSocket();
  const {
    playing,
    isMuted,
    playingUrl,
    playedSeconds,
    playedTimestampUpdatedAt,
    duration
  } = useRoomStore(
    (state) => ({
      playing: state.playing,
      isMuted: state.isMuted,
      playingUrl: state.playingUrl,
      playedSeconds: state.playedSeconds,
      duration: state.duration,
      playedTimestampUpdatedAt: state.playedTimestampUpdatedAt
    }),
    shallow
  );

  console.log(
    playing,
    isMuted,
    playingUrl,
    playedSeconds,
    playedTimestampUpdatedAt,
    duration
  );

  const playerRef = useRef<any>();
  const progressBarRef = useRef<any>();

  const onPlayerReady = (): void => {
    if (playing) {
      // const currentTimestamp =
      //   playedSeconds +
      //   (Date.now() - Number.parseInt(playedTimestampUpdatedAt)) / 1000;

      setPlaying(true);
      playerRef.current.seekTo(playedSeconds, 'seconds');
    } else {
      setPlaying(false);
      playerRef.current.seekTo(playedSeconds, 'seconds');
    }

    socket.on(RES_STREAMING_EVENTS, (videoEvent) => {
      // console.log(RES_STREAMING_EVENTS, videoEvent);
      const { isPlaying, playedSeconds } = videoEvent;
      const currentTimestamp = Number.parseFloat(playedSeconds);

      setPlaying(isPlaying);
      playerRef.current.seekTo(currentTimestamp, 'seconds');
    });
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

  const play = (): void => {
    setPlaying(true);
    const isPlaying = true;
    const timestamp = playerRef.current.getCurrentTime();
    const data = {
      roomId,
      isPlaying,
      timestamp
    };
    // console.log("play", data);
    socket.emit(REQ_STREAMING_EVENTS, data);
  };

  const pause = (): void => {
    setPlaying(false);
    const isPlaying = false;
    const timestamp = playerRef.current.getCurrentTime();
    const data = {
      roomId,
      isPlaying,
      timestamp
    };
    // console.log("pause", data);
    socket.emit(REQ_STREAMING_EVENTS, data);
  };

  const seek = (event: any): void => {
    const x = event.pageX - progressBarRef.current.getBoundingClientRect().left;
    const bw = progressBarRef.current.scrollWidth;
    const timestamp = (x / bw) * duration;
    setPlaying(true);
    playerRef.current.seekTo(timestamp, 'seconds');
    const isPlaying = true;
    const data = {
      roomId,
      isPlaying,
      timestamp
    };
    socket.emit(REQ_STREAMING_EVENTS, data);
  };

  const handleClickFullscreen = async (): Promise<void> => {
    if (screenfull.isEnabled) {
      await screenfull.request(playerRef.current.wrapper);
    }
  };

  return (
    <div className="flex flex-col tablet:flex-row w-full">
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
            url={playingUrl}
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

        <div className="flex col items-center p-2 bg-gray-800">
          <button className="mr-5" onClick={() => setPlaying(!playing)}>
            {playing ? (
              <BsPause onClick={pause} size={32} color={'white'} />
            ) : (
              <BsPlay onClick={play} size={32} color={'white'} />
            )}
          </button>

          <div className="mr-5 text-white">
            {getFormattedTime(playedSeconds)}
            {' / '}
            {getFormattedTime(duration)}
          </div>

          <div
            ref={progressBarRef}
            onClick={seek}
            className="flex-1 h-3 rounded-sm border-black bg-white"
          >
            <div
              className="h-3 bg-gray-400"
              style={{
                width: `${(playedSeconds / duration) * 100}%`
              }}
            ></div>
          </div>

          <button className="ml-5" onClick={() => setIsMuted(!isMuted)}>
            {!isMuted ? (
              <BsVolumeUp color={'white'} size={32} />
            ) : (
              <BsVolumeMute color={'white'} size={32} />
            )}
          </button>

          <button
            className="ml-5 mr-2"
            onClick={async () => await handleClickFullscreen()}
          >
            <BsFullscreen color={'white'} size={24} />
          </button>
        </div>
      </div>

      <div className="w-full tablet:w-1/4 bg-gray-600">Section</div>
    </div>
  );
};
