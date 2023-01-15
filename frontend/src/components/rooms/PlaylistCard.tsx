import VideoPlatformLogo from '@app/components/rooms/VideoPlatformLogo';
import { VideoInfo } from '@app/generated/graphql';
import {
  playExistingVideo,
  removeFromPlayList
} from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';

import {
  HStack,
  Icon,
  Image,
  Text,
  useColorModeValue,
  VStack
} from '@chakra-ui/react';
import { FC } from 'react';
import { AiOutlineDelete } from 'react-icons/ai';
import { BsPlayFill } from 'react-icons/bs';
interface VideoCardProps {
  video: VideoInfo;
  index: number;
  isPlaying: boolean;
}

export const PlaylistCard: FC<VideoCardProps> = ({
  video,
  index,
  isPlaying
}) => {
  const { socket } = useRoomContext();

  const onClickVideo = (index: number): void => {
    playExistingVideo(socket, index);
  };

  const onClickRemove = (index: number): void => {
    removeFromPlayList(socket, index);
  };

  return (
    <HStack
      p="2"
      justify="space-between"
      w="full"
      bg={useColorModeValue(
        isPlaying ? 'rgba(0, 0, 0, 0.1)' : 'inherit',
        isPlaying ? 'rgba(255, 255, 255, 0.1)' : 'inherit'
      )}
      _hover={{
        bg: useColorModeValue(
          isPlaying ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.05)',
          isPlaying ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)'
        ),
        '#deleteIcon': {
          opacity: isPlaying ? 0 : 1
        },
        cursor: 'pointer'
      }}
    >
      <HStack onClick={() => onClickVideo(index)}>
        <Icon
          color={useColorModeValue('black', 'gray.200')}
          opacity={isPlaying ? 1 : 0}
          alignSelf="center"
          as={BsPlayFill}
        />

        <Image
          width="100px"
          src={video.thumbnailUrl}
          alt={video.title}
          borderRadius="md"
        />

        <VStack align="flex-start" w="full">
          <Text
            color={useColorModeValue('gray.700', 'gray.50')}
            lineHeight={'shorter'}
            fontSize={'sm'}
            noOfLines={2}
            mr="1"
          >
            <VideoPlatformLogo platform={video.platform} />
            {video.title}
          </Text>
          <Text
            color={useColorModeValue('gray.600', 'gray.200')}
            fontSize="xs"
            noOfLines={1}
            mr="1"
          >
            {video.author}
          </Text>
        </VStack>
      </HStack>

      <Icon
        id="deleteIcon"
        width={5}
        height={5}
        opacity={0}
        onClick={() => onClickRemove(index)}
        color={useColorModeValue('black', 'gray.200')}
        alignSelf="center"
        as={AiOutlineDelete}
      />
    </HStack>
  );
};
