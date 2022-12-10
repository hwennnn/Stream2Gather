import ReactPlayer from "react-player/lazy";

export default function VideoPlayer(props: any) {
  return <ReactPlayer ref={props.playerref} {...props} />;
}
