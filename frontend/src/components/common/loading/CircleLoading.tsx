import { ChakraProps, Flex, Spinner } from '@chakra-ui/react';
import { FC } from 'react';
import FadeIn from 'react-fade-in';

interface Props {
  showFullScreen?: boolean;
}

export const CircleLoading: FC<ChakraProps> = (
  props,
  { showFullScreen = false }: Props
) => {
  return (
    <Flex
      h={showFullScreen ? 'full' : 'auto'}
      width={showFullScreen ? '100vw' : 'auto'}
      alignItems="center"
      justifyContent="center"
      {...props}
    >
      <FadeIn>
        <Spinner thickness="4px" color="secondary" size="xl" />
      </FadeIn>
    </Flex>
  );
};
