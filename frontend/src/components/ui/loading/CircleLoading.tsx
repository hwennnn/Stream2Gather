import { Flex, Spinner } from '@chakra-ui/react';
import { FC } from 'react';
import FadeIn from 'react-fade-in';

export const CircleLoading: FC = () => {
  return (
    <Flex h="full" width="100vw" alignItems="center" justifyContent="center">
      <FadeIn>
        <Spinner thickness="4px" color="secondary" size="xl" />
      </FadeIn>
    </Flex>
  );
};
