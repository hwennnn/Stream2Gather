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
    ...({"headers":{"Content-Type":"application/json"}}),
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

export type Mutation = {
  __typename?: 'Mutation';
  createRoom: RoomResponse;
  deleteRoom: Scalars['Boolean'];
  logout: Scalars['Boolean'];
  register: UserResponse;
};


export type MutationDeleteRoomArgs = {
  id: Scalars['String'];
};


export type MutationRegisterArgs = {
  options: UsernameEmailInput;
};

export type Query = {
  __typename?: 'Query';
  me?: Maybe<User>;
  room?: Maybe<Room>;
  rooms: Array<Room>;
  user?: Maybe<User>;
  users: Array<User>;
  usersWithRelations: Array<User>;
};


export type QueryRoomArgs = {
  id: Scalars['String'];
};


export type QueryUserArgs = {
  id: Scalars['String'];
};


export type QueryUsersWithRelationsArgs = {
  options: UserRelationsInput;
};

export type Room = {
  __typename?: 'Room';
  activeMembers?: Maybe<Array<RoomMember>>;
  createdAt: Scalars['String'];
  creator: User;
  id: Scalars['String'];
  isPublic: Scalars['Boolean'];
  members: Array<User>;
  roomInfo?: Maybe<RoomInfo>;
  updatedAt: Scalars['String'];
};

export type RoomInfo = {
  __typename?: 'RoomInfo';
  currentUrl: Scalars['String'];
  id: Scalars['String'];
  isPlaying: Scalars['Boolean'];
  playedSeconds: Scalars['Float'];
  playedTimestampUpdatedAt: Scalars['String'];
  playingIndex: Scalars['Int'];
  playlist: Array<VideoInfo>;
};

export type RoomMember = {
  __typename?: 'RoomMember';
  roomId: Scalars['String'];
  socketId: Scalars['String'];
  uid: Scalars['String'];
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
  email: Scalars['String'];
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

export type UsernameEmailInput = {
  email: Scalars['String'];
  username: Scalars['String'];
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

export type RegularErrorFragment = { __typename?: 'FieldError', field: string, message: string };

export type UserItemFragment = { __typename?: 'User', id: string, username: string, email: string, createdAt: string, updatedAt: string };

export type CreateRoomMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateRoomMutation = { __typename?: 'Mutation', createRoom: { __typename?: 'RoomResponse', errors?: Array<{ __typename?: 'FieldError', field: string, message: string }> | null, room?: { __typename?: 'Room', id: string, isPublic: boolean, createdAt: string, creator: { __typename?: 'User', id: string } } | null } };

export type LogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutMutation = { __typename?: 'Mutation', logout: boolean };

export type RegisterMutationVariables = Exact<{
  options: UsernameEmailInput;
}>;


export type RegisterMutation = { __typename?: 'Mutation', register: { __typename?: 'UserResponse', errors?: Array<{ __typename?: 'FieldError', field: string, message: string }> | null, user?: { __typename?: 'User', id: string, username: string, email: string, createdAt: string, updatedAt: string } | null } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { __typename?: 'Query', me?: { __typename?: 'User', id: string, username: string, email: string, createdAt: string, updatedAt: string } | null };

export type RoomQueryVariables = Exact<{
  id: Scalars['String'];
}>;


export type RoomQuery = { __typename?: 'Query', room?: { __typename?: 'Room', id: string, isPublic: boolean, createdAt: string, roomInfo?: { __typename?: 'RoomInfo', playedSeconds: number, isPlaying: boolean, playedTimestampUpdatedAt: string, currentUrl: string, playingIndex: number, playlist: Array<{ __typename?: 'VideoInfo', id: string, url: string, title: string, author: string, platform: string, thumbnailUrl: string }> } | null, creator: { __typename?: 'User', id: string }, activeMembers?: Array<{ __typename?: 'RoomMember', socketId: string }> | null } | null };

export type RoomsQueryVariables = Exact<{ [key: string]: never; }>;


export type RoomsQuery = { __typename?: 'Query', rooms: Array<{ __typename?: 'Room', id: string, isPublic: boolean, createdAt: string, roomInfo?: { __typename?: 'RoomInfo', playedSeconds: number, isPlaying: boolean, playedTimestampUpdatedAt: string, currentUrl: string } | null, creator: { __typename?: 'User', id: string }, activeMembers?: Array<{ __typename?: 'RoomMember', socketId: string }> | null }> };

export type UsersWithRelationsQueryVariables = Exact<{
  options: UserRelationsInput;
}>;


export type UsersWithRelationsQuery = { __typename?: 'Query', usersWithRelations: Array<{ __typename?: 'User', id: string, username: string, email: string, createdAt: string, updatedAt: string, createdRooms?: Array<{ __typename?: 'Room', id: string }> | null, rooms?: Array<{ __typename?: 'Room', id: string }> | null }> };

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
      id
      isPublic
      createdAt
      creator {
        id
      }
    }
  }
}
    ${RegularErrorFragmentDoc}`;
export const useCreateRoomMutation = <
      TError = unknown,
      TContext = unknown
    >(options?: UseMutationOptions<CreateRoomMutation, TError, CreateRoomMutationVariables, TContext>) =>
    useMutation<CreateRoomMutation, TError, CreateRoomMutationVariables, TContext>(
      ['CreateRoom'],
      (variables?: CreateRoomMutationVariables) => fetcher<CreateRoomMutation, CreateRoomMutationVariables>(CreateRoomDocument, variables)(),
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
    mutation Register($options: UsernameEmailInput!) {
  register(options: $options) {
    errors {
      field
      message
    }
    user {
      ...UserItem
    }
  }
}
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
export const RoomDocument = `
    query Room($id: String!) {
  room(id: $id) {
    id
    isPublic
    roomInfo {
      playedSeconds
      isPlaying
      playedTimestampUpdatedAt
      currentUrl
      playingIndex
      playlist {
        id
        url
        title
        author
        platform
        thumbnailUrl
      }
    }
    createdAt
    creator {
      id
    }
    activeMembers {
      socketId
    }
  }
}
    `;
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
export const RoomsDocument = `
    query Rooms {
  rooms {
    id
    isPublic
    roomInfo {
      playedSeconds
      isPlaying
      playedTimestampUpdatedAt
      currentUrl
    }
    createdAt
    creator {
      id
    }
    activeMembers {
      socketId
    }
  }
}
    `;
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