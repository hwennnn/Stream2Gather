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
}

export const QueryVideoCard: FC<QueryVideoCardProps> = ({ video }) => {
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
              fontSize={'xs'}
              noOfLines={3}
            >
              {video.title}
            </Text>

            <Text
              mt="2"
              color={useColorModeValue('gray.600', 'gray.200')}
              fontSize="11px"
              noOfLines={1}
            >
              {video.author}
            </Text>
          </Box>
        </CardBody>

        <CardFooter px="0" pb="0" pt="2">
          <Flex w="full" justify="space-between" flexWrap="wrap">
            <Button borderRadius="md" flex="1" mr="2">
              <Icon w={6} h={6} as={BsFillPlayFill} />
            </Button>
            <Button borderRadius="md" flex="1">
              <Icon w={6} h={6} as={BiAddToQueue} />
            </Button>
          </Flex>
        </CardFooter>
      </Card>
    </>
  );
};
