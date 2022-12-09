import Head from "next/head";
import { useRef, useState } from "react";
import {
  BsFullscreen,
  BsPause,
  BsPlay,
  BsVolumeMute,
  BsVolumeUp,
} from "react-icons/bs";
import ReactPlayer from "react-player";
import screenfull from "screenfull";
import { getFormattedTime } from "../helpers/time-helper";
import useWindowDimensions from "../hooks/useWindowDimensions";

export default function Home() {
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoAuthor, setVideoAuthor] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playingUrl, setPlayingUrl] = useState("https://youtu.be/Y8JFxS1HlDo");
  const [playingSeconds, setPlayingSeconds] = useState(0);
  const [duration, setDuration] = useState(0);

  const { width, height } = useWindowDimensions();

  const playerRef = useRef<any>();
  const progressBarRef = useRef<any>();

  const onPlayerReady = () => {
    setIsPlayerReady(true);
    setIsPlaying(true);
    setIsMuted(false);
  };

  const updateProgress = ({
    played,
    playedSeconds,
  }: {
    played: number;
    playedSeconds: number;
  }) => {
    setPlayingSeconds(playedSeconds);
  };

  const updateDuration = (duration: number) => {
    setDuration(duration);
  };

  const seek = (event: any) => {
    const x = event.pageX - progressBarRef.current.getBoundingClientRect().left;
    const bw = progressBarRef.current.scrollWidth;
    const timeline = (x / bw) * duration;
    playerRef.current.seekTo(timeline, "seconds");

    // var isPlaying = playing;
    // const data = {
    //     isPlaying,
    //     timeline
    // };
    // socket.emit('changes', {
    //     roomID,
    //     data
    // });
  };

  const handleClickFullscreen = () => {
    if (screenfull.isEnabled) {
      screenfull.request(playerRef.current.wrapper);
    }
  };

  return (
    <div className="">
      <Head>
        <title>Rooms | Stream2Gether</title>
        <meta
          name="description"
          content="A platform to watch videos in sync with your friends"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="relative pt-[56.25%]">
        <ReactPlayer
          className="absolute top-0 left-0"
          width="100%"
          height="100%"
          ref={playerRef}
          onReady={() => onPlayerReady()}
          onProgress={(callback: any) => updateProgress(callback)}
          onDuration={(duration: number) => updateDuration(duration)}
          muted={isMuted}
          playing={isPlaying}
          url={playingUrl}
          config={{
            youtube: {
              playerVars: {
                showinfo: 0,
                controls: 0,
                disablekb: 1,
                modestbranding: 1,
                rel: 0,
              },
            },
          }}
        />
      </div>

      <div className="flex col p-2 bg-gray-800">
        <button className="mr-5" onClick={() => setIsPlaying(!isPlaying)}>
          {!isPlaying ? (
            <BsPlay size={32} color={"white"} />
          ) : (
            <BsPause size={32} color={"white"} />
          )}
        </button>

        <div className="mt-1 mr-5 text-white">
          {getFormattedTime(playingSeconds)}
          {" / "}
          {getFormattedTime(duration)}
        </div>

        <div
          ref={progressBarRef}
          onClick={seek}
          className="flex-1 mt-2 h-4 rounded-sm border-black bg-white"
        >
          <div
            className="h-4 bg-gray-400"
            style={{ width: (playingSeconds / duration) * 100 + "%" }}
          ></div>
        </div>

        <button className="ml-5" onClick={() => setIsMuted(!isMuted)}>
          {!isMuted ? (
            <BsVolumeUp color={"white"} size={32} />
          ) : (
            <BsVolumeMute color={"white"} size={32} />
          )}
        </button>

        <button className="ml-5 mr-2" onClick={() => handleClickFullscreen()}>
          <BsFullscreen color={"white"} size={24} />
        </button>
      </div>
    </div>
  );
}
