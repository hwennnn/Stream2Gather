import { VideoInfo } from '@app/generated/graphql';
import {
  Box,
  Button,
  Card,
  CardBody,
  CardFooter,
  Flex,
  Icon,
  Image,
  Text,
  useColorModeValue
} from '@chakra-ui/react';
import { FC } from 'react';
import { BiAddToQueue } from 'react-icons/bi';
import { BsFillPlayFill } from 'react-icons/bs';

interface QueryVideoCardProps {
  video: VideoInfo;
  onClickPlay?: () => void;
  onClickAdd?: () => void;
}

export const QueryVideoCard: FC<QueryVideoCardProps> = ({
  video,
  onClickPlay,
  onClickAdd
}) => {
  return (
    <>
      <Card w="full">
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
              fontSize={{ base: 'xs', lg: 'sm' }}
              noOfLines={3}
            >
              {video.title}
            </Text>

            <Text
              mt="2"
              color={useColorModeValue('gray.600', 'gray.200')}
              fontSize={{ base: 'sm', lg: '11px' }}
              noOfLines={1}
            >
              {video.author}
            </Text>
          </Box>
        </CardBody>

        <CardFooter px="0" pb="0" pt="2">
          <Flex w="full" justify="space-between" flexWrap="wrap">
            <Button onClick={onClickPlay} borderRadius="md" flex="1" mr="1">
              <Icon w={6} h={6} as={BsFillPlayFill} />
            </Button>
            <Button onClick={onClickAdd} borderRadius="md" flex="1">
              <Icon w={6} h={6} as={BiAddToQueue} />
            </Button>
          </Flex>
        </CardFooter>
      </Card>
    </>
  );
};
