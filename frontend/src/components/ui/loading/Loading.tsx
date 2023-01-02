import { Flex } from '@chakra-ui/react';
import { FC } from 'react';
import FadeIn from 'react-fade-in';

import { PlayButtonAnimation } from './PlayButtonAnimation';

export const Loading: FC = () => {
  return (
    <Flex h="100vh" width="100vw" alignItems="center" justifyContent="center">
      <FadeIn>
        <PlayButtonAnimation />
      </FadeIn>
    </Flex>
  );
};
