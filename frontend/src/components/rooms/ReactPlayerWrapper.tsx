import React from 'react';
import ReactPlayer, { ReactPlayerProps } from 'react-player/lazy';

export default function ReactPlayerWrapper(
  props: ReactPlayerProps
): React.ReactElement {
  return <ReactPlayer ref={props.playerref} {...props} />;
}
