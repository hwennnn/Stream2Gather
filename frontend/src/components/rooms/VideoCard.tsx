import { VideoInfo } from '@app/generated/graphql';
import { playExistingVideo } from '@app/lib/roomSocketService';
import { useRoomSocket } from '@app/pages/room/[slug]';
import {
  HStack,
  Icon,
  Image,
  Text,
  useColorModeValue,
  VStack
} from '@chakra-ui/react';
import { FC } from 'react';
import { BsPlayFill } from 'react-icons/bs';

interface VideoCardProps {
  video: VideoInfo;
  index: number;
  isPlaying: boolean;
}

export const VideoCard: FC<VideoCardProps> = ({ video, index, isPlaying }) => {
  const { roomSocket } = useRoomSocket();

  const onVideoClick = (index: number): void => {
    playExistingVideo(roomSocket, index);
  };

  return (
    <HStack
      p="2"
      alignItems="flex-start"
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

        cursor: 'pointer'
      }}
      onClick={() => onVideoClick(index)}
    >
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
        >
          {video.title}
        </Text>
        <Text
          color={useColorModeValue('gray.600', 'gray.200')}
          fontSize="xs"
          noOfLines={1}
        >
          {video.author}
        </Text>
      </VStack>
    </HStack>
  );
};
