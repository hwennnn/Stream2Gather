export enum RoomInfoType {
  ADD_TO_QUEUE = 'ADD_TO_QUEUE',
  UPDATE_PLAYLIST = 'UPDATE_PLAYLIST',
  RESET_QUEUE = 'RESET_QUEUE',
  UPDATE_PLAYING_INDEX = 'UPDATE_PLAYING_INDEX'
}

export const CONNECT = 'connect';

// From frontend: I want to join a room
export const REQ_JOIN_ROOM = 'req_join_room';

// From frontend: I want to play/pause/seek to spefic timestamp
export const REQ_STREAMING_EVENTS = 'req_streaming_events';

// From frontend: I starts to play the video
export const REQ_PLAY_VIDEO = 'req_play_video';

// From frontend: I want to add a playable video id to the playlist
export const REQ_ADD_VIDEO_ID_TO_PLAYLIST = 'req_add_video_id_to_playlist';

// From frontend: I want to add a video to the playlist
export const REQ_ADD_TO_PLAYLIST = 'req_add_to_playlist';

// From frontend: I want to remove a video from the playlist
export const REQ_REMOVE_FROM_PLAYLIST = 'req_remove_from_playlist';

// From frontend: I want to play and add a video to the playlist
export const REQ_PLAY_NEW_VIDEO = 'req_play_new_video';

// From frontend: I want to reset the queue
export const REQ_RESET_QUEUE = 'req_reset_queue';

// From frontend: I want to play an existing video in the playlist
export const REQ_PLAY_EXISTING_VIDEO = 'req_play_existing_video';

// From frontend: The video has ended. I want to play the next video
export const REQ_PLAY_NEXT_VIDEO = 'req_play_next_video';

// From frontend: I want to send a message inside the group
export const REQ_SEND_MESSAGE = 'req_send_message';

// From backend: There is a new message in the group
export const RES_NEW_MESSAGE = 'res_new_message';

// From backend: There is a new member in the group
export const RES_NEW_MEMBER = 'res_new_member';

// From backend: There is a member left the group
export const RES_MEMBER_LEFT = 'res_member_left';

// From backend: This is the room info you requested
export const RES_ROOM_INFO = 'res_room_info';

// From backend: This are new streaming events
export const RES_STREAMING_EVENTS = 'res_streaming_events';

// From backend: You have successfully joined the room
export const RES_JOINED_ROOM = 'res_joined_room';

// From backend: The room you requested does not exist
export const RES_ROOM_DOES_NOT_EXIST = 'res_room_does_not_exist';

// From backend: The room you requested is inactive
export const RES_ROOM_INACTIVE = 'res_room_inactive';

// From backend: You have no permission to join the room
export const RES_ROOM_NO_PERMISSION = 'res_room_no_permission';

// From backend: You are already in the room
export const RES_ROOM_ALREADY_JOINED = 'res_room_already_joined';

// From backend: The room is already full
export const RES_ROOM_ALREADY_FULL = 'res_room_already_full';

// From backend: You have failed to join the room
export const RES_JOIN_ROOM_FAILED = 'res_join_room_failed';

// From redis publisher: There is a new message in the channel
export const REDIS_PUB_MESSAGE = 'message';

export const DISCONNECT = 'disconnect';
