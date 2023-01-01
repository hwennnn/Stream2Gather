import { FC, MutableRefObject } from 'react';
import {
  BsFullscreen,
  BsPause,
  BsPlay,
  BsVolumeMute,
  BsVolumeUp
} from 'react-icons/bs';
import screenfull from 'screenfull';
import shallow from 'zustand/shallow';
import { getFormattedTime } from '../../helpers/time-helper';
import { emitStreamEvent, StreamEvent } from '../../lib/roomSocketService';
import { useRoomSocket } from '../../pages/room';
import useRoomStore, { setIsMuted, setPlaying } from '../../store/useRoomStore';

interface PlayerControlProps {
  playerRef: MutableRefObject<any>;
  progressBarRef: MutableRefObject<any>;
}

const PlayerControl: FC<PlayerControlProps> = ({
  playerRef,
  progressBarRef
}) => {
  const { roomSocket: socket } = useRoomSocket();

  const { roomId, playing, isMuted, playedSeconds, duration } = useRoomStore(
    (state) => ({
      roomId: state.roomId,
      playing: state.playing,
      isMuted: state.isMuted,
      playedSeconds: state.playedSeconds,
      duration: state.duration
    }),
    shallow
  );

  const play = (): void => {
    setPlaying(true);
    const isPlaying = true;
    const timestamp = playerRef.current.getCurrentTime();

    const payload: StreamEvent = {
      roomId,
      isPlaying,
      timestamp
    };
    emitStreamEvent(socket, payload);
  };

  const pause = (): void => {
    setPlaying(false);
    const isPlaying = false;
    const timestamp = playerRef.current.getCurrentTime();

    const payload: StreamEvent = {
      roomId,
      isPlaying,
      timestamp
    };
    emitStreamEvent(socket, payload);
  };

  const seek = (event: any): void => {
    const x = event.pageX - progressBarRef.current.getBoundingClientRect().left;
    const bw = progressBarRef.current.scrollWidth;
    const timestamp = (x / bw) * duration;
    setPlaying(true);
    playerRef.current.seekTo(timestamp, 'seconds');

    const payload: StreamEvent = {
      roomId,
      isPlaying: true,
      timestamp
    };
    emitStreamEvent(socket, payload);
  };

  const handleClickFullscreen = async (): Promise<void> => {
    if (screenfull.isEnabled) {
      await screenfull.request(playerRef.current.wrapper);
    }
  };

  return (
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
          className="h-3 rounded-l-sm rounded-r-sm bg-gray-400"
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
  );
};

export default PlayerControl;
