import {
  FullRoomItemFragment,
  MessageItemFragment,
  RoomInfo,
  RoomMember,
  RoomMemberFragment,
  VideoInfo
} from '@app/generated/graphql';
import create from 'zustand';

export enum RoomJoiningStatus {
  LOADING,
  SUCCESS,
  DOES_NOT_EXIST,
  INACTIVE,
  NO_PERMISSION,
  ALREADY_IN_ROOM,
  ALREADY_FULL,
  FAILED // Error Base Case
}

export enum VideoResultTab {
  TRENDING_VIDEOS = 0,
  SEARCH_RESULTS = 1
}

export interface RoomMessage extends MessageItemFragment {
  frontendId?: string;
}

interface RoomState {
  roomId: string;
  roomSlug: string;
  creatorId: string;
  status: RoomJoiningStatus;

  membersMap: Map<string, RoomMemberFragment>;
  activeMembers: RoomMember[];

  isActive: boolean;
  isPublic: boolean;
  isTemporary: boolean;
  invitationCode?: string | null;

  duration: number;

  // Room Info
  playing: boolean;
  playedSeconds: number;
  playedTimestampUpdatedAt: string;

  playingIndex: number;
  playlist: VideoInfo[];
  currentVideo: VideoInfo | undefined;

  searchQuery: string;
  currentVideoResultTab: VideoResultTab;

  messages: RoomMessage[];
  hasMoreMessages: boolean;

  actions: {
    setRoom: (data: FullRoomItemFragment) => void;
    resetRoom: () => void;
    setRoomJoiningStatus: (status: RoomJoiningStatus) => void;
    setPlaying: (playing: boolean) => void;

    setPlayedSeconds: (playedSeconds: number) => void;
    setDuration: (duration: number) => void;
    setPlayingIndex: (playingIndex: number) => void;
    setPlaylist: (playlist: VideoInfo[]) => void;
    setCurrentVideo: (currentvideo: VideoInfo) => void;
    addToPlaylist: (videoInfo: VideoInfo) => void;
    updateRoomInfo: (roomInfo: RoomInfo) => void;

    addActiveMember: (member: RoomMember) => void;
    removeActiveMember: (socketId: string) => void;

    setSearchQuery: (query: string) => void;
    setCurrentVideoResultTab: (tab: VideoResultTab) => void;

    setRoomMessages: (m: RoomMessage[]) => void;
    pushRoomMessage: (m: RoomMessage) => void;
  };
}

const initialRoomData = {
  roomId: '',
  roomSlug: '',
  creatorId: '',
  status: RoomJoiningStatus.LOADING,
  isActive: true,
  isTemporary: true,
  isPublic: false,
  membersMap: new Map<string, RoomMemberFragment>(),
  activeMembers: [],
  duration: 0,
  playing: false,
  playedSeconds: 0,
  playedTimestampUpdatedAt: '0',
  playingIndex: 0,
  playlist: [],
  currentVideo: undefined,
  searchQuery: '',
  currentVideoResultTab: VideoResultTab.TRENDING_VIDEOS,
  messages: [],
  hasMoreMessages: true
};

const useRoomStore = create<RoomState>()((set) => ({
  ...initialRoomData,
  actions: {
    setRoom: (data: FullRoomItemFragment) => {
      const members = data.members;
      const membersMap = new Map<string, RoomMemberFragment>();

      if (members !== null && members !== undefined) {
        for (const member of members) {
          membersMap.set(member.id, member);
        }
      }

      const roomInfo = data.roomInfo;
      set({
        membersMap,
        roomId: data.id,
        roomSlug: data.slug,
        creatorId: data.creatorId,
        isActive: data.isActive,
        isTemporary: data.isTemporary,
        isPublic: data.isPublic,
        invitationCode: data.invitationCode,
        activeMembers: data.activeMembers,
        playing: roomInfo.isPlaying,
        playedSeconds: roomInfo.playedSeconds,
        playedTimestampUpdatedAt: roomInfo.playedTimestampUpdatedAt,
        playingIndex: roomInfo.playingIndex,
        playlist: roomInfo.playlist,
        currentVideo: roomInfo.playlist[roomInfo.playingIndex]
      });
    },
    setRoomMessages: (messages: RoomMessage[]) => {
      set((state) => {
        const hasMoreMessages = messages.length === 25;
        const newMessages = state.messages.concat(messages);
        return {
          messages: newMessages,
          hasMoreMessages
        };
      });
    },
    pushRoomMessage: (m: RoomMessage) => {
      set((state) => {
        const currentMessages = state.messages;
        if (m.frontendId !== undefined) {
          const index = currentMessages.findIndex(
            (message) => message.frontendId === m.frontendId
          );

          if (index !== -1) {
            currentMessages[index] = m;
            return { messages: [...currentMessages] };
          }
        }

        const messages = [m, ...currentMessages];
        return { messages };
      });
    },
    resetRoom: () =>
      set((state) => {
        return { ...initialRoomData, status: state.status };
      }),
    setRoomJoiningStatus: (status) => set({ status }),
    setPlaying: (playing) => set({ playing }),
    setPlayedSeconds: (playedSeconds) => set({ playedSeconds }),
    setDuration: (duration) => set({ duration }),
    setPlayingIndex: (playingIndex) => set({ playingIndex }),
    setPlaylist: (playlist) => set({ playlist }),
    setCurrentVideo: (currentVideo) => set({ currentVideo }),
    addActiveMember: (member) =>
      set((state) => {
        const roomMember: RoomMemberFragment = {
          id: member.uid,
          username: member.username,
          displayPhoto: member.displayPhoto
        };
        const membersMap = new Map(state.membersMap).set(
          member.uid,
          roomMember
        );

        const activeMembers = [...state.activeMembers, member];
        return { activeMembers, membersMap };
      }),
    removeActiveMember: (socketId) =>
      set((state) => {
        const activeMembers = state.activeMembers.filter(
          (m) => m.socketId !== socketId
        );
        return { activeMembers };
      }),
    addToPlaylist: (videoInfo) =>
      set((state) => {
        const playlist = [...state.playlist, videoInfo];
        return { playlist };
      }),
    updateRoomInfo: (roomInfo) =>
      set((_) => {
        return {
          playlist: [...roomInfo.playlist],
          playing: roomInfo.isPlaying,
          playedSeconds: roomInfo.playedSeconds,
          playedTimestampUpdatedAt: roomInfo.playedTimestampUpdatedAt,
          playingIndex: roomInfo.playingIndex,
          currentVideo: roomInfo.currentVideo
        };
      }),
    setSearchQuery: (query) => {
      set({
        searchQuery: query
      });
    },
    setCurrentVideoResultTab: (tab) => {
      set({
        currentVideoResultTab: tab
      });
    }
  }
}));

export const {
  setRoom,
  resetRoom,
  setRoomJoiningStatus,
  setPlaying,
  setPlayedSeconds,
  setDuration,
  setPlayingIndex,
  setPlaylist,
  setCurrentVideo,
  addActiveMember,
  removeActiveMember,
  addToPlaylist,
  updateRoomInfo,
  setSearchQuery,
  setCurrentVideoResultTab,
  setRoomMessages,
  pushRoomMessage
} = useRoomStore.getState().actions;

export default useRoomStore;
