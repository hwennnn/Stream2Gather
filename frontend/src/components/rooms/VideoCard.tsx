import { VideoInfo } from '@app/generated/graphql';
import {
  HStack,
  Image,
  Text,
  useColorModeValue,
  VStack
} from '@chakra-ui/react';
import { FC } from 'react';

interface VideoCardProps {
  video: VideoInfo;
  isPlaying: boolean;
}

export const VideoCard: FC<VideoCardProps> = ({ video }) => {
  return (
    <HStack alignItems="flex-start" w="full">
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
