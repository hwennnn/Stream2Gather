import { CloseIcon } from '@chakra-ui/icons';
import { Box, Flex, Heading, Text } from '@chakra-ui/react';
import { FC } from 'react';

const ErrorPage: FC = () => {
  return (
    <Box mx="auto" maxWidth="lg" textAlign="center" py={10} px={6}>
      <Box display="inline-block">
        <Flex
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          bg={'red.500'}
          rounded={'50px'}
          w={'55px'}
          h={'55px'}
          textAlign="center"
        >
          <CloseIcon boxSize={'20px'} color={'white'} />
        </Flex>
      </Box>
      <Heading as="h2" size="xl" mt={6} mb={2}>
        An error has occured.
      </Heading>
      <Text color={'gray.500'}>
        {
          "We're sorry, but an error has occurred. It looks like there was a\
        problem with the information you entered. Please check your input and\
        try again. If you continue to experience issues, don't hesitate to\
        contact us for assistance"
        }
      </Text>
    </Box>
  );
};

export default ErrorPage;
