import {
  Box,
  Flex,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack
} from '@chakra-ui/react';
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
import { getFormattedTime } from '../../../helpers/time-helper';
import { emitStreamEvent, StreamEvent } from '../../../lib/roomSocketService';
import { useRoomSocket } from '../../../pages/room';
import useRoomStore, {
  setIsMuted,
  setPlayedSeconds,
  setPlaying
} from '../../../store/useRoomStore';

interface PlayerControlProps {
  playerRef: MutableRefObject<any>;
}

const PlayerControl: FC<PlayerControlProps> = ({ playerRef }) => {
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

  const seek = (value: number): void => {
    const timestamp = (value / 100) * duration;
    // optimistically update the playedSeconds store
    setPlayedSeconds(timestamp);

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
    <Flex direction="row" alignItems="center" p="2" bg="gray.800">
      <Box mr="5" onClick={() => setPlaying(!playing)}>
        {playing ? (
          <BsPause onClick={pause} size={32} color={'white'} />
        ) : (
          <BsPlay onClick={play} size={32} color={'white'} />
        )}
      </Box>

      <Box mr="5" textColor="white">
        {getFormattedTime(playedSeconds)}
        {' / '}
        {getFormattedTime(duration)}
      </Box>

      <Box flex="1">
        <Slider
          mt="2"
          aria-label="slider-ex-1"
          value={(playedSeconds / duration) * 100}
          defaultValue={0}
          onChange={(value) => {
            seek(value);
          }}
        >
          <SliderTrack>
            <SliderFilledTrack />
          </SliderTrack>
          <SliderThumb />
        </Slider>
      </Box>

      <Box ml="5" onClick={() => setIsMuted(!isMuted)}>
        {!isMuted ? (
          <BsVolumeUp color={'white'} size={32} />
        ) : (
          <BsVolumeMute color={'white'} size={32} />
        )}
      </Box>

      <Box ml="5" mr="2" onClick={async () => await handleClickFullscreen()}>
        <BsFullscreen color={'white'} size={24} />
      </Box>
    </Flex>
  );
};

export default PlayerControl;
