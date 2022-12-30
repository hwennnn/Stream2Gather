import React from 'react';
import ReactPlayer from 'react-player/lazy';

export default function ReactPlayerWrapper(props: any): React.ReactElement {
  return <ReactPlayer ref={props.playerref} {...props} />;
}
