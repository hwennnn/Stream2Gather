export const CONNECT = 'connect';

// From frontend: I want to join a room
export const REQ_JOIN_ROOM = 'req_join_room';

// From frontend: I want to play/pause/seek to spefic timestamp
export const REQ_STREAMING_EVENTS = 'req_streaming_events';

// From frontend: I start to play the video
export const REQ_PLAY_VIDEO = 'req_play_video';

// From frontend: I want to add a video to the playlist
export const REQ_ADD_TO_PLAYLIST = 'req_add_to_playlist';

// From frontend: I want to add a video to the playlist
export const REQ_PLAY_NEW_VIDEO = 'req_play_new_video';

// From backend: There is a new message in the group
export const RES_MESSAGE = 'res_messages';

// From backend: There is a new member in the group
export const RES_NEW_MEMBER = 'res_new_member';

// From backend: There is a member left the group
export const RES_MEMBER_LEFT = 'res_member_left';

// From backend: This is an update inside the room info
export const RES_ROOM_INFO = 'res_room_info';

// From backend: This are new streaming events
export const RES_STREAMING_EVENTS = 'res_streaming_events';

// From backend: You have successfully joined the room
export const RES_JOINED_ROOM = 'res_joined_room';

// From backend: The room you requested does not exist
export const RES_ROOM_DOES_NOT_EXIST = 'res_room_does_not_exist';

// From backend: The room you requested is inactive
export const RES_ROOM_INACTIVE = 'res_room_inactive';

// From backend: You are already in the room
export const RES_ROOM_ALREADY_JOINED = 'res_room_already_joined';

// From backend: You have no permission to join the room
export const RES_ROOM_NO_PERMISSION = 'res_room_no_permission';

// From backend: You have failed to join the room
export const RES_JOIN_ROOM_FAILED = 'res_join_room_failed';

// From redis publisher: There is a new message in the channel
export const REDIS_PUB_MESSAGE = 'message';

export const DISCONNECT = 'disconnect';
