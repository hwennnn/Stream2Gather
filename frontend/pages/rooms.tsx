import { useRef } from 'react';
import {
  BsFullscreen,
  BsPause,
  BsPlay,
  BsVolumeMute,
  BsVolumeUp
} from 'react-icons/bs';

import { NextPage } from 'next';
import dynamic from 'next/dynamic';
import screenfull from 'screenfull';
import { io } from 'socket.io-client';
import Layout from '../components/Layout';
import {
  REQ_JOIN_ROOM,
  REQ_STREAMING_EVENTS,
  RES_MEMBER_LEFT,
  RES_NEW_MEMBER,
  RES_ROOM_INFO,
  RES_STREAMING_EVENTS
} from '../constants/socket';
import { getFormattedTime } from '../helpers/time-helper';
import useRoomStore from '../store/useRoomStore';

const ReactPlayer = dynamic(() => import('../components/VideoPlayer'), {
  ssr: false
});

interface Props {
  id: string | string[] | undefined;
}

const socket = io(`${process.env.SERVER_URL}`, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity
});

const Rooms: NextPage<Props> = ({ id }) => {
  const playing = useRoomStore((state) => state.playing);
  const isMuted = useRoomStore((state) => state.isMuted);
  const playingUrl = useRoomStore((state) => state.playingUrl);
  const playedSeconds = useRoomStore((state) => state.playedSeconds);
  const duration = useRoomStore((state) => state.duration);

  const setPlaying = useRoomStore((state) => state.setPlaying);
  const setIsMuted = useRoomStore((state) => state.setIsMuted);
  const setPlayingUrl = useRoomStore((state) => state.setPlayingUrl);
  const setPlayedSeconds = useRoomStore((state) => state.setPlayedSeconds);
  const setDuration = useRoomStore((state) => state.setDuration);

  console.log(playing, isMuted, playingUrl, playedSeconds, duration);

  const playerRef = useRef<any>();
  const progressBarRef = useRef<any>();

  const onPlayerReady = () => {
    // setPlaying(true);
    setIsMuted(true);

    socket.emit(REQ_JOIN_ROOM, {
      roomId: id,
      uid: 'hwen'
    });

    socket.on(RES_NEW_MEMBER, (member) => {
      console.log(RES_NEW_MEMBER, member);
    });

    socket.on(RES_MEMBER_LEFT, (socketID) => {
      console.log(RES_MEMBER_LEFT, socketID);
    });

    socket.on(RES_ROOM_INFO, (roomInfo) => {
      console.log(RES_ROOM_INFO, roomInfo);
      const { isPlaying, playedSeconds, playedTimestampUpdatedAt, currentUrl } =
        roomInfo;

      // console.log(
      //     "init",
      //     isPlaying,
      //     playedSeconds,
      //     playedTimestampUpdatedAt,
      //     currentUrl
      // );

      if (currentUrl !== playingUrl) {
        setPlayingUrl(currentUrl);
      }

      if (isPlaying === true) {
        const currentTimestamp =
          Number.parseFloat(playedSeconds) +
          (Date.now() - Number.parseInt(playedTimestampUpdatedAt)) / 1000;

        setPlaying(true);
        playerRef.current.seekTo(currentTimestamp, 'seconds');
      } else {
        const currentTimestamp = Number.parseFloat(playedSeconds);

        setPlaying(false);
        playerRef.current.seekTo(currentTimestamp, 'seconds');
      }
    });

    socket.on(RES_STREAMING_EVENTS, (videoEvent) => {
      console.log(RES_STREAMING_EVENTS, videoEvent);
      const { isPlaying, playedSeconds } = videoEvent;
      const currentTimestamp = Number.parseFloat(playedSeconds);

      setPlaying(isPlaying);
      playerRef.current.seekTo(currentTimestamp, 'seconds');
    });
  };

  const updateProgress = ({
    played,
    playedSeconds
  }: {
    played: number;
    playedSeconds: number;
  }) => {
    setPlayedSeconds(playedSeconds);
  };

  const updateDuration = (duration: number) => {
    setDuration(duration);
  };

  const play = () => {
    setPlaying(true);

    let isPlaying = true;
    let timestamp = playerRef.current.getCurrentTime();
    const data = {
      roomId: id,
      isPlaying,
      timestamp
    };
    // console.log("play", data);
    socket.emit(REQ_STREAMING_EVENTS, data);
  };

  const pause = () => {
    setPlaying(false);

    let isPlaying = false;
    let timestamp = playerRef.current.getCurrentTime();
    const data = {
      roomId: id,
      isPlaying,
      timestamp
    };
    // console.log("pause", data);
    socket.emit(REQ_STREAMING_EVENTS, data);
  };

  const seek = (event: any) => {
    const x = event.pageX - progressBarRef.current.getBoundingClientRect().left;
    const bw = progressBarRef.current.scrollWidth;
    const timestamp = (x / bw) * duration;

    setPlaying(true);
    playerRef.current.seekTo(timestamp, 'seconds');

    let isPlaying = true;
    const data = {
      roomId: id,
      isPlaying,
      timestamp
    };

    socket.emit(REQ_STREAMING_EVENTS, data);
  };

  const handleClickFullscreen = () => {
    if (screenfull.isEnabled) {
      screenfull.request(playerRef.current.wrapper);
    }
  };

  return (
    <Layout title="Room">
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
              playing={playing}
              url={playingUrl}
              config={{
                youtube: {
                  playerVars: {
                    showinfo: 0,
                    controls: 0,
                    disablekb: 1,
                    modestbranding: 1,
                    rel: 0
                  }
                }
              }}
              playerref={playerRef}
            />
          </div>

          <div className="flex col items-center p-2 bg-gray-800">
            <button className="mr-5" onClick={() => setPlaying(!playing)}>
              {playing ? (
                <BsPause onClick={pause} size={32} color={'white'} />
              ) : (
                <BsPlay onClick={play} size={32} color={'white'} />
              )}
            </button>

            <div className="mr-5 text-white">
              {getFormattedTime(playedSeconds)}
              {' / '}
              {getFormattedTime(duration)}
            </div>

            <div
              ref={progressBarRef}
              onClick={seek}
              className="flex-1 h-3 rounded-sm border-black bg-white"
            >
              <div
                className="h-3 bg-gray-400"
                style={{
                  width: (playedSeconds / duration) * 100 + '%'
                }}
              ></div>
            </div>

            <button className="ml-5" onClick={() => setIsMuted(!isMuted)}>
              {!isMuted ? (
                <BsVolumeUp color={'white'} size={32} />
              ) : (
                <BsVolumeMute color={'white'} size={32} />
              )}
            </button>

            <button
              className="ml-5 mr-2"
              onClick={() => handleClickFullscreen()}
            >
              <BsFullscreen color={'white'} size={24} />
            </button>
          </div>
        </div>

        <div className="w-full tablet:w-1/4 bg-gray-600">Section</div>
      </div>
    </Layout>
  );
};

Rooms.getInitialProps = async ({ query }) => {
  const { id } = query;

  return { id };
};

export default Rooms;
