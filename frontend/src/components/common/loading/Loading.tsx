import { Player } from '@lottiefiles/react-lottie-player';
import { FC } from 'react';
import FadeIn from 'react-fade-in';
import playButtonAnimation from './lottie-playbutton.json';

export const Loading: FC = () => {
  return (
    <div className="flex w-screen h-screen items-center justify-center">
      <FadeIn>
        <Player
          className="flex w-60 h-60 items-center justify-center overflow-hidden"
          src={playButtonAnimation}
          speed={2}
          loop={true}
          autoplay={true}
        />
      </FadeIn>
    </div>
  );
};
