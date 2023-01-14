import { ChakraProps, Flex, Spinner } from '@chakra-ui/react';
import { FC } from 'react';
import FadeIn from 'react-fade-in';

interface Props {
  showfullscreen?: 'true';
}

export const CircleLoading: FC<ChakraProps & Props> = (props) => {
  return (
    <Flex
      h={props.showfullscreen === 'true' ? 'full' : 'auto'}
      width={props.showfullscreen === 'true' ? '100vw' : 'auto'}
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
