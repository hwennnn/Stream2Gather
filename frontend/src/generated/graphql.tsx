import { useMutation, useQuery, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };

function fetcher<TData, TVariables>(query: string, variables?: TVariables) {
  return async (): Promise<TData> => {
    const res = await fetch("http://localhost:8080/graphql", {
    method: "POST",
    ...({"headers":{"Content-Type":"application/json"},"credentials":"include"}),
      body: JSON.stringify({ query, variables }),
    });

    const json = await res.json();

    if (json.errors) {
      const { message } = json.errors[0];

      throw new Error(message);
    }

    return json.data;
  }
}
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
};

export type FieldError = {
  __typename?: 'FieldError';
  field: Scalars['String'];
  message: Scalars['String'];
};

export type LoginInput = {
  token: Scalars['String'];
};

export type Message = {
  __typename?: 'Message';
  content: Scalars['String'];
  createdAt: Scalars['String'];
  creatorId: Scalars['String'];
  id: Scalars['String'];
  room?: Maybe<Room>;
  updatedAt: Scalars['String'];
};

export type MessageInput = {
  content: Scalars['String'];
  roomId: Scalars['String'];
};

export type MessageResponse = {
  __typename?: 'MessageResponse';
  errors?: Maybe<Array<FieldError>>;
  message?: Maybe<Message>;
};

export type Mutation = {
  __typename?: 'Mutation';
  createMessage: MessageResponse;
  createRoom: RoomResponse;
  deleteRoom: Scalars['Boolean'];
  login: UserResponse;
  logout: Scalars['Boolean'];
  register: UserResponse;
  socialLogin: UserResponse;
};


export type MutationCreateMessageArgs = {
  options: MessageInput;
};


export type MutationDeleteRoomArgs = {
  id: Scalars['String'];
};


export type MutationLoginArgs = {
  options: LoginInput;
};


export type MutationRegisterArgs = {
  options: RegisterInput;
};


export type MutationSocialLoginArgs = {
  options: RegisterInput;
};

export type Query = {
  __typename?: 'Query';
  me?: Maybe<User>;
  ownRooms?: Maybe<User>;
  room?: Maybe<Room>;
  roomMessages?: Maybe<Array<Message>>;
  rooms: Array<Room>;
  user?: Maybe<User>;
  users: Array<User>;
  usersWithRelations: Array<User>;
  youtubeTrendingVideos: Array<VideoInfo>;
  youtubeVideoInfo?: Maybe<VideoInfo>;
  youtubeVideos: Array<VideoInfo>;
};


export type QueryRoomArgs = {
  slug: Scalars['String'];
};


export type QueryRoomMessagesArgs = {
  slug: Scalars['String'];
};


export type QueryUserArgs = {
  id: Scalars['String'];
};


export type QueryUsersWithRelationsArgs = {
  options: UserRelationsInput;
};


export type QueryYoutubeVideoInfoArgs = {
  videoId: Scalars['String'];
};


export type QueryYoutubeVideosArgs = {
  keyword: Scalars['String'];
};

export type RegisterInput = {
  displayPhoto?: InputMaybe<Scalars['String']>;
  email?: InputMaybe<Scalars['String']>;
  token: Scalars['String'];
  username: Scalars['String'];
};

export type Room = {
  __typename?: 'Room';
  activeMembers: Array<RoomMember>;
  bannedUsers: Array<Scalars['String']>;
  createdAt: Scalars['String'];
  creator?: Maybe<User>;
  creatorId: Scalars['String'];
  id: Scalars['String'];
  invitationCode?: Maybe<Scalars['String']>;
  isActive: Scalars['Boolean'];
  isPublic: Scalars['Boolean'];
  isTemporary: Scalars['Boolean'];
  members?: Maybe<Array<User>>;
  messages?: Maybe<Array<Message>>;
  roomInfo: RoomInfo;
  slug: Scalars['String'];
  updatedAt: Scalars['String'];
};

export type RoomInfo = {
  __typename?: 'RoomInfo';
  currentVideo: VideoInfo;
  id: Scalars['String'];
  isPlaying: Scalars['Boolean'];
  playedSeconds: Scalars['Float'];
  playedTimestampUpdatedAt: Scalars['String'];
  playingIndex: Scalars['Int'];
  playlist: Array<VideoInfo>;
};

export type RoomMember = {
  __typename?: 'RoomMember';
  displayPhoto?: Maybe<Scalars['String']>;
  roomId: Scalars['String'];
  socketId: Scalars['String'];
  uid: Scalars['String'];
  username: Scalars['String'];
};

export type RoomResponse = {
  __typename?: 'RoomResponse';
  errors?: Maybe<Array<FieldError>>;
  room?: Maybe<Room>;
};

export type User = {
  __typename?: 'User';
  createdAt: Scalars['String'];
  createdRooms?: Maybe<Array<Room>>;
  displayPhoto?: Maybe<Scalars['String']>;
  email?: Maybe<Scalars['String']>;
  id: Scalars['String'];
  rooms?: Maybe<Array<Room>>;
  updatedAt: Scalars['String'];
  username: Scalars['String'];
};

export type UserRelationsInput = {
  createdRooms?: Scalars['Boolean'];
  rooms?: Scalars['Boolean'];
};

export type UserResponse = {
  __typename?: 'UserResponse';
  errors?: Maybe<Array<FieldError>>;
  user?: Maybe<User>;
};

export type VideoInfo = {
  __typename?: 'VideoInfo';
  author: Scalars['String'];
  id: Scalars['String'];
  platform: Scalars['String'];
  thumbnailUrl: Scalars['String'];
  title: Scalars['String'];
  url: Scalars['String'];
};

export type ActiveMemberFragment = { __typename?: 'RoomMember', uid: string, username: string, socketId: string, roomId: string, displayPhoto?: string | null };

export type FullRoomItemFragment = { __typename?: 'Room', id: string, slug: string, isActive: boolean, isTemporary: boolean, isPublic: boolean, invitationCode?: string | null, creatorId: string, roomInfo: { __typename?: 'RoomInfo', playingIndex: number, isPlaying: boolean, playedSeconds: number, playedTimestampUpdatedAt: string, playlist: Array<{ __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string }>, currentVideo: { __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string } }, members?: Array<{ __typename?: 'User', id: string, username: string, displayPhoto?: string | null }> | null, activeMembers: Array<{ __typename?: 'RoomMember', uid: string, username: string, socketId: string, roomId: string, displayPhoto?: string | null }> };

export type MessageItemFragment = { __typename?: 'Message', id: string, creatorId: string, content: string, createdAt: string, updatedAt: string };

export type RegularErrorFragment = { __typename?: 'FieldError', field: string, message: string };

export type RoomItemFragment = { __typename?: 'Room', id: string, slug: string, isActive: boolean, isTemporary: boolean, isPublic: boolean, invitationCode?: string | null, creatorId: string };

export type RoomMemberFragment = { __typename?: 'User', id: string, username: string, displayPhoto?: string | null };

export type UserItemFragment = { __typename?: 'User', id: string, username: string, email?: string | null, displayPhoto?: string | null, createdAt: string, updatedAt: string };

export type VideoItemFragment = { __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string };

export type CreateRoomMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateRoomMutation = { __typename?: 'Mutation', createRoom: { __typename?: 'RoomResponse', errors?: Array<{ __typename?: 'FieldError', field: string, message: string }> | null, room?: { __typename?: 'Room', id: string, slug: string, isActive: boolean, isTemporary: boolean, isPublic: boolean, invitationCode?: string | null, creatorId: string } | null } };

export type LoginMutationVariables = Exact<{
  options: LoginInput;
}>;


export type LoginMutation = { __typename?: 'Mutation', login: { __typename?: 'UserResponse', errors?: Array<{ __typename?: 'FieldError', field: string, message: string }> | null, user?: { __typename?: 'User', id: string, username: string, email?: string | null, displayPhoto?: string | null, createdAt: string, updatedAt: string } | null } };

export type LogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutMutation = { __typename?: 'Mutation', logout: boolean };

export type RegisterMutationVariables = Exact<{
  options: RegisterInput;
}>;


export type RegisterMutation = { __typename?: 'Mutation', register: { __typename?: 'UserResponse', errors?: Array<{ __typename?: 'FieldError', field: string, message: string }> | null, user?: { __typename?: 'User', id: string, username: string, email?: string | null, displayPhoto?: string | null, createdAt: string, updatedAt: string } | null } };

export type SocialLoginMutationVariables = Exact<{
  options: RegisterInput;
}>;


export type SocialLoginMutation = { __typename?: 'Mutation', socialLogin: { __typename?: 'UserResponse', errors?: Array<{ __typename?: 'FieldError', field: string, message: string }> | null, user?: { __typename?: 'User', id: string, username: string, email?: string | null, displayPhoto?: string | null, createdAt: string, updatedAt: string } | null } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { __typename?: 'Query', me?: { __typename?: 'User', id: string, username: string, email?: string | null, displayPhoto?: string | null, createdAt: string, updatedAt: string } | null };

export type OwnRoomsQueryVariables = Exact<{ [key: string]: never; }>;


export type OwnRoomsQuery = { __typename?: 'Query', ownRooms?: { __typename?: 'User', rooms?: Array<{ __typename?: 'Room', id: string, slug: string, isActive: boolean, isTemporary: boolean, isPublic: boolean, invitationCode?: string | null, creatorId: string, roomInfo: { __typename?: 'RoomInfo', playingIndex: number, isPlaying: boolean, playedSeconds: number, playedTimestampUpdatedAt: string, playlist: Array<{ __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string }>, currentVideo: { __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string } }, activeMembers: Array<{ __typename?: 'RoomMember', uid: string, username: string, socketId: string, roomId: string, displayPhoto?: string | null }> }> | null } | null };

export type RoomQueryVariables = Exact<{
  slug: Scalars['String'];
}>;


export type RoomQuery = { __typename?: 'Query', room?: { __typename?: 'Room', id: string, slug: string, isActive: boolean, isTemporary: boolean, isPublic: boolean, invitationCode?: string | null, creatorId: string, roomInfo: { __typename?: 'RoomInfo', playingIndex: number, isPlaying: boolean, playedSeconds: number, playedTimestampUpdatedAt: string, playlist: Array<{ __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string }>, currentVideo: { __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string } }, members?: Array<{ __typename?: 'User', id: string, username: string, displayPhoto?: string | null }> | null, activeMembers: Array<{ __typename?: 'RoomMember', uid: string, username: string, socketId: string, roomId: string, displayPhoto?: string | null }> } | null };

export type RoomMessagesQueryVariables = Exact<{
  slug: Scalars['String'];
}>;


export type RoomMessagesQuery = { __typename?: 'Query', roomMessages?: Array<{ __typename?: 'Message', id: string, creatorId: string, content: string, createdAt: string, updatedAt: string }> | null };

export type RoomsQueryVariables = Exact<{ [key: string]: never; }>;


export type RoomsQuery = { __typename?: 'Query', rooms: Array<{ __typename?: 'Room', id: string, slug: string, isActive: boolean, isTemporary: boolean, isPublic: boolean, invitationCode?: string | null, creatorId: string, roomInfo: { __typename?: 'RoomInfo', playingIndex: number, isPlaying: boolean, playedSeconds: number, playedTimestampUpdatedAt: string, playlist: Array<{ __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string }>, currentVideo: { __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string } }, members?: Array<{ __typename?: 'User', id: string, username: string, displayPhoto?: string | null }> | null, activeMembers: Array<{ __typename?: 'RoomMember', uid: string, username: string, socketId: string, roomId: string, displayPhoto?: string | null }> }> };

export type SearchYoutubeVideosQueryVariables = Exact<{
  keyword: Scalars['String'];
}>;


export type SearchYoutubeVideosQuery = { __typename?: 'Query', youtubeVideos: Array<{ __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string }> };

export type UsersWithRelationsQueryVariables = Exact<{
  options: UserRelationsInput;
}>;


export type UsersWithRelationsQuery = { __typename?: 'Query', usersWithRelations: Array<{ __typename?: 'User', id: string, username: string, email?: string | null, displayPhoto?: string | null, createdAt: string, updatedAt: string, createdRooms?: Array<{ __typename?: 'Room', id: string }> | null, rooms?: Array<{ __typename?: 'Room', id: string }> | null }> };

export type YoutubeTrendingVideosQueryVariables = Exact<{ [key: string]: never; }>;


export type YoutubeTrendingVideosQuery = { __typename?: 'Query', youtubeTrendingVideos: Array<{ __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string }> };

export type YoutubeVideoInfoQueryVariables = Exact<{
  videoId: Scalars['String'];
}>;


export type YoutubeVideoInfoQuery = { __typename?: 'Query', youtubeVideoInfo?: { __typename?: 'VideoInfo', id: string, platform: string, title: string, author: string, url: string, thumbnailUrl: string } | null };

export const RoomItemFragmentDoc = `
    fragment RoomItem on Room {
  id
  slug
  isActive
  isTemporary
  isPublic
  invitationCode
  creatorId
}
    `;
export const VideoItemFragmentDoc = `
    fragment VideoItem on VideoInfo {
  id
  platform
  title
  author
  url
  thumbnailUrl
}
    `;
export const RoomMemberFragmentDoc = `
    fragment RoomMember on User {
  id
  username
  displayPhoto
}
    `;
export const ActiveMemberFragmentDoc = `
    fragment ActiveMember on RoomMember {
  uid
  username
  socketId
  roomId
  displayPhoto
}
    `;
export const FullRoomItemFragmentDoc = `
    fragment FullRoomItem on Room {
  ...RoomItem
  roomInfo {
    playingIndex
    playlist {
      ...VideoItem
    }
    currentVideo {
      ...VideoItem
    }
    isPlaying
    playedSeconds
    playedTimestampUpdatedAt
  }
  members {
    ...RoomMember
  }
  activeMembers {
    ...ActiveMember
  }
}
    ${RoomItemFragmentDoc}
${VideoItemFragmentDoc}
${RoomMemberFragmentDoc}
${ActiveMemberFragmentDoc}`;
export const MessageItemFragmentDoc = `
    fragment MessageItem on Message {
  id
  creatorId
  content
  createdAt
  updatedAt
}
    `;
export const RegularErrorFragmentDoc = `
    fragment RegularError on FieldError {
  field
  message
}
    `;
export const UserItemFragmentDoc = `
    fragment UserItem on User {
  id
  username
  email
  displayPhoto
  createdAt
  updatedAt
}
    `;
export const CreateRoomDocument = `
    mutation CreateRoom {
  createRoom {
    errors {
      ...RegularError
    }
    room {
      ...RoomItem
    }
  }
}
    ${RegularErrorFragmentDoc}
${RoomItemFragmentDoc}`;
export const useCreateRoomMutation = <
      TError = unknown,
      TContext = unknown
    >(options?: UseMutationOptions<CreateRoomMutation, TError, CreateRoomMutationVariables, TContext>) =>
    useMutation<CreateRoomMutation, TError, CreateRoomMutationVariables, TContext>(
      ['CreateRoom'],
      (variables?: CreateRoomMutationVariables) => fetcher<CreateRoomMutation, CreateRoomMutationVariables>(CreateRoomDocument, variables)(),
      options
    );
export const LoginDocument = `
    mutation Login($options: LoginInput!) {
  login(options: $options) {
    errors {
      ...RegularError
    }
    user {
      ...UserItem
    }
  }
}
    ${RegularErrorFragmentDoc}
${UserItemFragmentDoc}`;
export const useLoginMutation = <
      TError = unknown,
      TContext = unknown
    >(options?: UseMutationOptions<LoginMutation, TError, LoginMutationVariables, TContext>) =>
    useMutation<LoginMutation, TError, LoginMutationVariables, TContext>(
      ['Login'],
      (variables?: LoginMutationVariables) => fetcher<LoginMutation, LoginMutationVariables>(LoginDocument, variables)(),
      options
    );
export const LogoutDocument = `
    mutation Logout {
  logout
}
    `;
export const useLogoutMutation = <
      TError = unknown,
      TContext = unknown
    >(options?: UseMutationOptions<LogoutMutation, TError, LogoutMutationVariables, TContext>) =>
    useMutation<LogoutMutation, TError, LogoutMutationVariables, TContext>(
      ['Logout'],
      (variables?: LogoutMutationVariables) => fetcher<LogoutMutation, LogoutMutationVariables>(LogoutDocument, variables)(),
      options
    );
export const RegisterDocument = `
    mutation Register($options: RegisterInput!) {
  register(options: $options) {
    errors {
      ...RegularError
    }
    user {
      ...UserItem
    }
  }
}
    ${RegularErrorFragmentDoc}
${UserItemFragmentDoc}`;
export const useRegisterMutation = <
      TError = unknown,
      TContext = unknown
    >(options?: UseMutationOptions<RegisterMutation, TError, RegisterMutationVariables, TContext>) =>
    useMutation<RegisterMutation, TError, RegisterMutationVariables, TContext>(
      ['Register'],
      (variables?: RegisterMutationVariables) => fetcher<RegisterMutation, RegisterMutationVariables>(RegisterDocument, variables)(),
      options
    );
export const SocialLoginDocument = `
    mutation SocialLogin($options: RegisterInput!) {
  socialLogin(options: $options) {
    errors {
      ...RegularError
    }
    user {
      ...UserItem
    }
  }
}
    ${RegularErrorFragmentDoc}
${UserItemFragmentDoc}`;
export const useSocialLoginMutation = <
      TError = unknown,
      TContext = unknown
    >(options?: UseMutationOptions<SocialLoginMutation, TError, SocialLoginMutationVariables, TContext>) =>
    useMutation<SocialLoginMutation, TError, SocialLoginMutationVariables, TContext>(
      ['SocialLogin'],
      (variables?: SocialLoginMutationVariables) => fetcher<SocialLoginMutation, SocialLoginMutationVariables>(SocialLoginDocument, variables)(),
      options
    );
export const MeDocument = `
    query Me {
  me {
    ...UserItem
  }
}
    ${UserItemFragmentDoc}`;
export const useMeQuery = <
      TData = MeQuery,
      TError = unknown
    >(
      variables?: MeQueryVariables,
      options?: UseQueryOptions<MeQuery, TError, TData>
    ) =>
    useQuery<MeQuery, TError, TData>(
      variables === undefined ? ['Me'] : ['Me', variables],
      fetcher<MeQuery, MeQueryVariables>(MeDocument, variables),
      options
    );

useMeQuery.getKey = (variables?: MeQueryVariables) => variables === undefined ? ['Me'] : ['Me', variables];
;

export const OwnRoomsDocument = `
    query OwnRooms {
  ownRooms {
    rooms {
      ...RoomItem
      roomInfo {
        playingIndex
        playlist {
          ...VideoItem
        }
        currentVideo {
          ...VideoItem
        }
        isPlaying
        playedSeconds
        playedTimestampUpdatedAt
      }
      activeMembers {
        ...ActiveMember
      }
    }
  }
}
    ${RoomItemFragmentDoc}
${VideoItemFragmentDoc}
${ActiveMemberFragmentDoc}`;
export const useOwnRoomsQuery = <
      TData = OwnRoomsQuery,
      TError = unknown
    >(
      variables?: OwnRoomsQueryVariables,
      options?: UseQueryOptions<OwnRoomsQuery, TError, TData>
    ) =>
    useQuery<OwnRoomsQuery, TError, TData>(
      variables === undefined ? ['OwnRooms'] : ['OwnRooms', variables],
      fetcher<OwnRoomsQuery, OwnRoomsQueryVariables>(OwnRoomsDocument, variables),
      options
    );

useOwnRoomsQuery.getKey = (variables?: OwnRoomsQueryVariables) => variables === undefined ? ['OwnRooms'] : ['OwnRooms', variables];
;

export const RoomDocument = `
    query Room($slug: String!) {
  room(slug: $slug) {
    ...FullRoomItem
  }
}
    ${FullRoomItemFragmentDoc}`;
export const useRoomQuery = <
      TData = RoomQuery,
      TError = unknown
    >(
      variables: RoomQueryVariables,
      options?: UseQueryOptions<RoomQuery, TError, TData>
    ) =>
    useQuery<RoomQuery, TError, TData>(
      ['Room', variables],
      fetcher<RoomQuery, RoomQueryVariables>(RoomDocument, variables),
      options
    );

useRoomQuery.getKey = (variables: RoomQueryVariables) => ['Room', variables];
;

export const RoomMessagesDocument = `
    query RoomMessages($slug: String!) {
  roomMessages(slug: $slug) {
    ...MessageItem
  }
}
    ${MessageItemFragmentDoc}`;
export const useRoomMessagesQuery = <
      TData = RoomMessagesQuery,
      TError = unknown
    >(
      variables: RoomMessagesQueryVariables,
      options?: UseQueryOptions<RoomMessagesQuery, TError, TData>
    ) =>
    useQuery<RoomMessagesQuery, TError, TData>(
      ['RoomMessages', variables],
      fetcher<RoomMessagesQuery, RoomMessagesQueryVariables>(RoomMessagesDocument, variables),
      options
    );

useRoomMessagesQuery.getKey = (variables: RoomMessagesQueryVariables) => ['RoomMessages', variables];
;

export const RoomsDocument = `
    query Rooms {
  rooms {
    ...FullRoomItem
  }
}
    ${FullRoomItemFragmentDoc}`;
export const useRoomsQuery = <
      TData = RoomsQuery,
      TError = unknown
    >(
      variables?: RoomsQueryVariables,
      options?: UseQueryOptions<RoomsQuery, TError, TData>
    ) =>
    useQuery<RoomsQuery, TError, TData>(
      variables === undefined ? ['Rooms'] : ['Rooms', variables],
      fetcher<RoomsQuery, RoomsQueryVariables>(RoomsDocument, variables),
      options
    );

useRoomsQuery.getKey = (variables?: RoomsQueryVariables) => variables === undefined ? ['Rooms'] : ['Rooms', variables];
;

export const SearchYoutubeVideosDocument = `
    query SearchYoutubeVideos($keyword: String!) {
  youtubeVideos(keyword: $keyword) {
    ...VideoItem
  }
}
    ${VideoItemFragmentDoc}`;
export const useSearchYoutubeVideosQuery = <
      TData = SearchYoutubeVideosQuery,
      TError = unknown
    >(
      variables: SearchYoutubeVideosQueryVariables,
      options?: UseQueryOptions<SearchYoutubeVideosQuery, TError, TData>
    ) =>
    useQuery<SearchYoutubeVideosQuery, TError, TData>(
      ['SearchYoutubeVideos', variables],
      fetcher<SearchYoutubeVideosQuery, SearchYoutubeVideosQueryVariables>(SearchYoutubeVideosDocument, variables),
      options
    );

useSearchYoutubeVideosQuery.getKey = (variables: SearchYoutubeVideosQueryVariables) => ['SearchYoutubeVideos', variables];
;

export const UsersWithRelationsDocument = `
    query UsersWithRelations($options: UserRelationsInput!) {
  usersWithRelations(options: $options) {
    ...UserItem
    createdRooms {
      id
    }
    rooms {
      id
    }
  }
}
    ${UserItemFragmentDoc}`;
export const useUsersWithRelationsQuery = <
      TData = UsersWithRelationsQuery,
      TError = unknown
    >(
      variables: UsersWithRelationsQueryVariables,
      options?: UseQueryOptions<UsersWithRelationsQuery, TError, TData>
    ) =>
    useQuery<UsersWithRelationsQuery, TError, TData>(
      ['UsersWithRelations', variables],
      fetcher<UsersWithRelationsQuery, UsersWithRelationsQueryVariables>(UsersWithRelationsDocument, variables),
      options
    );

useUsersWithRelationsQuery.getKey = (variables: UsersWithRelationsQueryVariables) => ['UsersWithRelations', variables];
;

export const YoutubeTrendingVideosDocument = `
    query YoutubeTrendingVideos {
  youtubeTrendingVideos {
    ...VideoItem
  }
}
    ${VideoItemFragmentDoc}`;
export const useYoutubeTrendingVideosQuery = <
      TData = YoutubeTrendingVideosQuery,
      TError = unknown
    >(
      variables?: YoutubeTrendingVideosQueryVariables,
      options?: UseQueryOptions<YoutubeTrendingVideosQuery, TError, TData>
    ) =>
    useQuery<YoutubeTrendingVideosQuery, TError, TData>(
      variables === undefined ? ['YoutubeTrendingVideos'] : ['YoutubeTrendingVideos', variables],
      fetcher<YoutubeTrendingVideosQuery, YoutubeTrendingVideosQueryVariables>(YoutubeTrendingVideosDocument, variables),
      options
    );

useYoutubeTrendingVideosQuery.getKey = (variables?: YoutubeTrendingVideosQueryVariables) => variables === undefined ? ['YoutubeTrendingVideos'] : ['YoutubeTrendingVideos', variables];
;

export const YoutubeVideoInfoDocument = `
    query YoutubeVideoInfo($videoId: String!) {
  youtubeVideoInfo(videoId: $videoId) {
    ...VideoItem
  }
}
    ${VideoItemFragmentDoc}`;
export const useYoutubeVideoInfoQuery = <
      TData = YoutubeVideoInfoQuery,
      TError = unknown
    >(
      variables: YoutubeVideoInfoQueryVariables,
      options?: UseQueryOptions<YoutubeVideoInfoQuery, TError, TData>
    ) =>
    useQuery<YoutubeVideoInfoQuery, TError, TData>(
      ['YoutubeVideoInfo', variables],
      fetcher<YoutubeVideoInfoQuery, YoutubeVideoInfoQueryVariables>(YoutubeVideoInfoDocument, variables),
      options
    );

useYoutubeVideoInfoQuery.getKey = (variables: YoutubeVideoInfoQueryVariables) => ['YoutubeVideoInfo', variables];
;
