import { getFormattedTime } from '@app/helpers/time-helper';
import { emitStreamEvent, StreamEvent } from '@app/lib/roomSocketService';
import { useRoomSocket } from '@app/pages/room/[slug]';
import useRoomStore, {
  setIsMuted,
  setPlayedSeconds,
  setPlaying,
  setVolume
} from '@app/store/useRoomStore';
import {
  Box,
  Flex,
  HStack,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Spacer,
  Text
} from '@chakra-ui/react';
import { FC, MutableRefObject, useState } from 'react';
import {
  BsFullscreen,
  BsPauseFill,
  BsPlayFill,
  BsVolumeMuteFill,
  BsVolumeUpFill
} from 'react-icons/bs';
import screenfull from 'screenfull';
import shallow from 'zustand/shallow';

interface PlayerControlProps {
  playerRef: MutableRefObject<any>;
  playerWrapperRef: MutableRefObject<any>;
}

const PlayerControl: FC<PlayerControlProps> = ({ playerRef }) => {
  const { roomSocket: socket } = useRoomSocket();
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);

  const { roomId, playing, isMuted, volume, playedSeconds, duration } =
    useRoomStore(
      (state) => ({
        roomId: state.roomId,
        playing: state.playing,
        isMuted: state.isMuted,
        volume: state.volume,
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
            <BsPauseFill onClick={pause} size={32} color={'white'} />
          ) : (
            <BsPlayFill onClick={play} size={32} color={'white'} />
          )}
        </Box>

        <HStack
          spacing={3}
          onMouseOver={() => {
            if (isVolumeHovered) return;
            setIsVolumeHovered(true);
          }}
          onMouseLeave={() => {
            if (!isVolumeHovered) return;
            setTimeout(() => {
              setIsVolumeHovered(false);
            }, 200);
          }}
        >
          <Box onClick={() => setIsMuted(!isMuted)}>
            {!isMuted && volume > 0 ? (
              <BsVolumeUpFill color={'white'} size={32} />
            ) : (
              <BsVolumeMuteFill color={'white'} size={32} />
            )}
          </Box>

          <Slider
            mt="2"
            width={'50px'}
            aria-label="slider-ex-2"
            colorScheme={'red'}
            value={isMuted ? 0 : volume}
            defaultValue={100}
            onChange={(value) => {
              if (value > 0 && isMuted) {
                setIsMuted(false);
              }
              setVolume(value);
            }}
          >
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb />
          </Slider>
        </HStack>

        <Text
          userSelect={'none'}
          fontSize={'sm'}
          textColor="white"
        >{`${getFormattedTime(playedSeconds)} / ${getFormattedTime(
          duration
        )}`}</Text>

        <Spacer />

        <Box ml="5" mr="2" onClick={async () => await handleClickFullscreen()}>
          <BsFullscreen color={'white'} size={24} />
        </Box>
      </HStack>
    </Flex>
  );
};

export default PlayerControl;
