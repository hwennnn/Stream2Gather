import { ChakraProps, Flex, Spinner } from '@chakra-ui/react';
import { FC } from 'react';
import FadeIn from 'react-fade-in';

interface Props {
  showFullScreen?: boolean;
}

export const CircleLoading: FC<ChakraProps & Props> = (props) => {
  console.log(props.showFullScreen);
  return (
    <Flex
      h={props.showFullScreen === true ? 'full' : 'auto'}
      width={props.showFullScreen === true ? '100vw' : 'auto'}
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
