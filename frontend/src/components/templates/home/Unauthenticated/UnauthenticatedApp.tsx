import {
  Button,
  Container,
  Heading,
  Stack,
  Text,
  useColorModeValue
} from '@chakra-ui/react';
import Link from 'next/link';
import { FC } from 'react';

const UnauthenticatedApp: FC = () => {
  return (
    <Container maxW={'5xl'}>
      <Stack
        textAlign={'center'}
        align={'center'}
        spacing={{ base: 8, md: 10 }}
        py={{ base: 20, md: 28 }}
      >
        <Heading
          fontWeight={'bold'}
          fontSize={{ base: '3xl', sm: '4xl', md: '6xl' }}
          lineHeight={'110%'}
        >
          Stay Connected{' '}
          <Text
            as={'span'}
            color={useColorModeValue('secondary', 'secondaryDark')}
          >
            made easier.
          </Text>
        </Heading>
        <Text
          fontWeight={'semibold'}
          color={'gray.500'}
          maxW={'3xl'}
          fontSize={{ base: 'sm', sm: 'md', md: 'lg', lg: 'xl' }}
        >
          {
            "Stay connected with your loved ones even when you can't be together in \
            person with our online platform. Our platform allows you to watch entertaining \
            videos on various streaming services in sync, creating a seamless and immersive \
            viewing experience as if you were in real person."
          }
        </Text>
        <Stack spacing={6} direction={'row'}>
          <Link href="/register">
            <Button fontWeight={'600'} variant="primary" px={6}>
              Get started
            </Button>
          </Link>
        </Stack>

        {/* <Flex w={'full'}>
          <Illustration
            height={{ sm: '24rem', lg: '28rem' }}
            mt={{ base: 12, sm: 16 }}
          />
        </Flex> */}
      </Stack>
    </Container>
  );
};

export default UnauthenticatedApp;
