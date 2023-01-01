export const CONNECT = 'connect';

// From frontend: I want to join a room
export const REQ_JOIN_ROOM = 'req_join_room';

// From frontend: I already left a room
export const REQ_LEFT_ROOM = 'req_left_room';

// From frontend: I want to play/pause/seek to spefic timestamp
export const REQ_STREAMING_EVENTS = 'req_streaming_events';

// From frontend: I starts to play the video
export const REQ_PLAY_VIDEO = 'req_play_video';

// From backend: There is a new message in the group
export const RES_MESSAGE = 'res_messages';

// From backend: There is a new member in the group
export const RES_NEW_MEMBER = 'res_new_member';

// From backend: There is a member left the group
export const RES_MEMBER_LEFT = 'res_member_left';

// From backend: This is the room info you requested
export const RES_ROOM_INFO = 'res_room_info';

// From backend: This are new streaming events
export const RES_STREAMING_EVENTS = 'res_streaming_events';

// From redis publisher: There is a new message in the channel
export const REDIS_PUB_MESSAGE = 'message';

export const DISCONNECT = 'disconnect';
