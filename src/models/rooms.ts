export interface RoomMember {
    uid: string;
    socketID: string;
    roomID: string;
}

export interface RoomInfo {
    roomID: string;
    currentURL: string;
    playingIndex: number;
    playlist: VideoInfo[];
}

export interface VideoInfo {
    playedTimestamp: string;
    lastTimestampUpdatedTime: string;
    videoID: string;
    videoURL: string;
    thumbnailURL: string;
    videoTitle: string;
    videoAuthor: string;
    isPlaying: boolean;
}