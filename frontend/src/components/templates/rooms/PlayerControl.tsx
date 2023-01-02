import {
  Box,
  Flex,
  HStack,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Spacer
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
  playerWrapperRef: MutableRefObject<any>;
}

const PlayerControl: FC<PlayerControlProps> = ({
  playerRef,
  playerWrapperRef
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

  const seeking = (value: number): void => {
    const timestamp = (value / 100) * duration;
    // optimistically update the playedSeconds store
    setPlayedSeconds(timestamp);

    setPlaying(true);
    playerRef.current.seekTo(timestamp, 'seconds');
  };

  const seek = (value: number): void => {
    const timestamp = (value / 100) * duration;

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
    <Flex w="full" direction={'column'} mb="3">
      <Box flex="1">
        <Slider
          mt="2"
          aria-label="slider-ex-1"
          value={duration === 0 ? 0 : (playedSeconds / duration) * 100}
          defaultValue={0}
          onChangeEnd={(value) => {
            seek(value);
          }}
          onChange={(value) => {
            seeking(value);
          }}
        >
          <SliderTrack>
            <SliderFilledTrack />
          </SliderTrack>
          <SliderThumb />
        </Slider>
      </Box>

      <HStack spacing={5} w="full" alignItems="center">
        <Box onClick={() => setPlaying(!playing)}>
          {playing ? (
            <BsPause onClick={pause} size={32} color={'white'} />
          ) : (
            <BsPlay onClick={play} size={32} color={'white'} />
          )}
        </Box>

        <Box onClick={() => setIsMuted(!isMuted)}>
          {!isMuted ? (
            <BsVolumeUp color={'white'} size={32} />
          ) : (
            <BsVolumeMute color={'white'} size={32} />
          )}
        </Box>

        <Box textColor="white">
          {getFormattedTime(playedSeconds)}
          {' / '}
          {getFormattedTime(duration)}
        </Box>

        <Spacer />

        <Box ml="5" mr="2" onClick={async () => await handleClickFullscreen()}>
          <BsFullscreen color={'white'} size={24} />
        </Box>
      </HStack>
    </Flex>
  );
};

export default PlayerControl;
