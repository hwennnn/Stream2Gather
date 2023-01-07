import { VideoInfo } from '@app/generated/graphql';
import {
  Box,
  Button,
  Card,
  CardBody,
  CardFooter,
  Image,
  Text,
  useColorModeValue
} from '@chakra-ui/react';
import { FC } from 'react';

interface QueryVideoCardProps {
  video: VideoInfo;
}

export const QueryVideoCard: FC<QueryVideoCardProps> = ({ video }) => {
  return (
    <>
      <Card w="full">
        <CardBody p="0">
          <Image src={video.thumbnailUrl} alt={video.title} borderRadius="md" />

          <Box p="2">
            <Text
              color={useColorModeValue('gray.700', 'gray.50')}
              lineHeight={'shorter'}
              fontSize={'sm'}
              noOfLines={3}
            >
              {video.title}
            </Text>

            <Text
              mt="2"
              color={useColorModeValue('gray.600', 'gray.200')}
              fontSize="xs"
              noOfLines={1}
            >
              {video.author}
            </Text>
          </Box>
        </CardBody>

        <CardFooter px="2" justify="space-between" flexWrap="wrap">
          <Button size="sm">Play</Button>
          <Button size="sm">Add to Queue</Button>
        </CardFooter>
      </Card>
    </>
  );
};
