import Head from "next/head";
import { useRef, useState } from "react";
import {
  BsFullscreen,
  BsPause,
  BsPlay,
  BsVolumeMute,
  BsVolumeUp,
} from "react-icons/bs";

import { NextPage } from "next";
import dynamic from "next/dynamic";
import screenfull from "screenfull";
import { io } from "socket.io-client";
import { getFormattedTime } from "../helpers/time-helper";
import useWindowDimensions from "../hooks/useWindowDimensions";

const ReactPlayer = dynamic(() => import("../components/VideoPlayer"), {
  ssr: false,
});
const SERVER_URL: string = process.env.SERVER_URL as string;
const socket = io(SERVER_URL);

interface Props {
  id: string | string[] | undefined;
}

const Rooms: NextPage<Props> = ({ id }) => {
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
    // setIsPlaying(true);
    setIsMuted(true);

    socket.emit("join-room", {
      roomID: id,
      uid: "hwen",
    });

    socket.on("member_add", (member) => {
      console.log("new member", member);
    });

    socket.on("member_left", (socketID) => {
      console.log("member left", socketID);
    });

    socket.on("room_info", (roomInfo) => {
      console.log("roomInfo", roomInfo);
      const { playingIndex, playlist } = roomInfo;
      const { isPlaying, playedTimestamp, lastTimestampUpdatedTime } =
        playlist[playingIndex];
      const currentTimestamp =
        Number.parseInt(playedTimestamp) +
        (Date.now() - Number.parseInt(lastTimestampUpdatedTime)) / 1000;

      setIsPlaying(isPlaying);
      playerRef.current.seekTo(currentTimestamp, "seconds");
    });

    socket.on("video_events", (videoEvent) => {
      const { isPlaying, playedTimestamp, lastTimestampUpdatedTime } =
        videoEvent;
      const currentTimestamp = Number.parseInt(playedTimestamp);

      setIsPlaying(isPlaying);
      playerRef.current.seekTo(currentTimestamp, "seconds");
    });
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

  const play = () => {
    var isPlaying = true;
    var timestamp = playerRef.current.getCurrentTime();
    const data = {
      roomID: id,
      isPlaying,
      timestamp,
    };

    socket.emit("video-events", data);
  };

  const pause = () => {
    var isPlaying = false;
    var timestamp = playerRef.current.getCurrentTime();
    const data = {
      roomID: id,
      isPlaying,
      timestamp,
    };

    socket.emit("video-events", data);
  };

  const seek = (event: any) => {
    const x = event.pageX - progressBarRef.current.getBoundingClientRect().left;
    const bw = progressBarRef.current.scrollWidth;
    const timestamp = (x / bw) * duration;

    setIsPlaying(true);
    playerRef.current.seekTo(timestamp, "seconds");

    var isPlaying = true;
    const data = {
      roomID: id,
      isPlaying,
      timestamp,
    };

    socket.emit("video-events", data);
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

      <div className="flex flex-col tablet:flex-row w-full">
        <div className="w-full tablet:w-3/4">
          <div className="relative pt-[56.25%]">
            <ReactPlayer
              className="absolute top-0 left-0"
              width="100%"
              height="100%"
              // onPlay={() => play()}
              // onPause={() => pause()}
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
              playerref={playerRef}
            />
          </div>

          <div className="flex col items-center p-2 bg-gray-800">
            <button className="mr-5" onClick={() => setIsPlaying(!isPlaying)}>
              {isPlaying ? (
                <BsPause onClick={pause} size={32} color={"white"} />
              ) : (
                <BsPlay onClick={play} size={32} color={"white"} />
              )}
            </button>

            <div className="mr-5 text-white">
              {getFormattedTime(playingSeconds)}
              {" / "}
              {getFormattedTime(duration)}
            </div>

            <div
              ref={progressBarRef}
              onClick={seek}
              className="flex-1 h-3 rounded-sm border-black bg-white"
            >
              <div
                className="h-3 bg-gray-400"
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

            <button
              className="ml-5 mr-2"
              onClick={() => handleClickFullscreen()}
            >
              <BsFullscreen color={"white"} size={24} />
            </button>
          </div>
        </div>

        <div className="w-full tablet:w-1/4 bg-gray-600">Section</div>
      </div>
    </div>
  );
};

Rooms.getInitialProps = async ({ query }) => {
  const { id } = query;

  return { id };
};

export default Rooms;
