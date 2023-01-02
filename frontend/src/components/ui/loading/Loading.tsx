import { Flex } from '@chakra-ui/react';
import { FC } from 'react';
import FadeIn from 'react-fade-in';
import { PlayLoadingAnimation } from './PlayLoadingAnimation';

export const Loading: FC = () => {
  return (
    <Flex
      width="100vw"
      height="100vh"
      alignItems="center"
      justifyContent="center"
    >
      <FadeIn>
        <PlayLoadingAnimation />
      </FadeIn>
    </Flex>
  );
};
