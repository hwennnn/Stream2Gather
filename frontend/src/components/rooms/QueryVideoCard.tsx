import VideoPlatformLogo from '@app/components/rooms/VideoPlatformLogo';
import { VideoInfo } from '@app/generated/graphql';
import {
  Box,
  Button,
  Card,
  CardBody,
  Icon,
  Image,
  Text,
  useColorModeValue
} from '@chakra-ui/react';
import { FC } from 'react';
import { MdPlaylistAdd } from 'react-icons/md';

interface QueryVideoCardProps {
  video: VideoInfo;
  onClickPlay: () => void;
  onClickAdd: () => void;
}

export const QueryVideoCard: FC<QueryVideoCardProps> = ({
  video,
  onClickPlay,
  onClickAdd
}) => {
  return (
    <Card
      w="full"
      cursor="pointer"
      onClick={onClickPlay}
      _hover={{
        '#cardOverlay': {
          opacity: 1
        }
      }}
    >
      <Box
        zIndex={1}
        id="cardOverlay"
        opacity={0}
        pos="absolute"
        top={0}
        right={0}
        onClick={(event) => {
          event.stopPropagation();
          onClickAdd();
        }}
      >
        <Button
          mt={1}
          mr={1}
          bg="black"
          px={2}
          borderRadius="md"
          flex="1"
          _hover={{
            opacity: 1
          }}
        >
          <Icon w={6} h={6} as={MdPlaylistAdd} />
        </Button>
      </Box>
      <CardBody p="0">
        <Image
          w="full"
          src={video.thumbnailUrl}
          alt={video.title}
          borderRadius="sm"
        />

        <Box p="2">
          <Text
            color={useColorModeValue('gray.700', 'gray.50')}
            lineHeight={'shorter'}
            fontSize={{ base: 'sm' }}
            noOfLines={2}
          >
            <VideoPlatformLogo platform={video.platform} />
            {video.title}
          </Text>

          <Text
            mt="2"
            color={useColorModeValue('gray.600', 'gray.200')}
            fontSize={{ base: 'xs' }}
            noOfLines={1}
          >
            {video.author}
          </Text>
        </Box>
      </CardBody>
    </Card>
  );
};
