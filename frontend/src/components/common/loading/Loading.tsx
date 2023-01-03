import { PlayButtonAnimation } from '@app/components/common/loading/PlayButtonAnimation';
import { Flex } from '@chakra-ui/react';
import { FC } from 'react';
import FadeIn from 'react-fade-in';

export const Loading: FC = () => {
  return (
    <Flex h="100vh" width="100vw" alignItems="center" justifyContent="center">
      <FadeIn>
        <PlayButtonAnimation />
      </FadeIn>
    </Flex>
  );
};
