/* eslint-disable react/no-children-prop */
import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { useAuth } from '@app/contexts/AuthContext';
import {
  RoomMemberFragment,
  useInfiniteRoomMessagesQuery
} from '@app/generated/graphql';
import { sendMessage } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import useRoomStore, {
  RoomMessage,
  setRoomMessages
} from '@app/store/useRoomStore';
import useUserSettingsStore from '@app/store/useUserSettingsStore';
import { formatMsToMinutesSeconds } from '@app/utils/formatDatetime';
import {
  Avatar,
  Box,
  BoxProps,
  Flex,
  forwardRef,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  Tooltip,
  VStack
} from '@chakra-ui/react';
import { FC, useRef, useState } from 'react';
import { IoMdSend } from 'react-icons/io';
import InfiniteScroll from 'react-infinite-scroll-component';

const MessageComposer: FC<{
  scrollToBottom: () => void;
}> = ({ scrollToBottom }) => {
  const { socket } = useRoomContext();
  const [message, setMessage] = useState('');

  const submitForm = (): void => {
    if (message.length > 0) {
      sendMessage(socket, message);
      setMessage('');
      scrollToBottom();
    }
  };

  return (
    <Box w="full" px="1">
      <form
        onSubmit={(event) => {
          submitForm();
          event.preventDefault();
        }}
      >
        <InputGroup>
          <Input
            type="text"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
            fontSize={{ base: 'sm', md: 'md' }}
            maxLength={128}
            size="lg"
            placeholder="Enter a message"
          />
          <InputRightElement
            h="full"
            children={<IoMdSend size={24} type="submit" onClick={submitForm} />}
          />
        </InputGroup>
      </form>
    </Box>
  );
};

const MessageBox: FC<{
  message: RoomMessage;
  isOwn: boolean;
  member: RoomMemberFragment | undefined;
}> = ({ message, isOwn, member }) => {
  return (
    <HStack px="1" mt="3" w="full">
      {!isOwn && (
        <Tooltip
          hasArrow
          label={member?.username}
          aria-label="Tooltip for message"
        >
          <Avatar
            alignSelf="start"
            name={member?.username ?? 'Deleted User'}
            size={'sm'}
            src={member?.displayPhoto ?? undefined}
          />
        </Tooltip>
      )}
      <VStack
        w="full"
        flexDirection="column"
        alignItems={isOwn ? 'flex-end' : 'flex-start'}
      >
        <Tooltip
          label={formatMsToMinutesSeconds(message.createdAt)}
          aria-label="Tooltip for message"
        >
          <Box
            maxW="70%"
            px="3"
            py="2"
            backgroundColor={isOwn ? 'secondary' : 'gray.200'}
            rounded={20}
            roundedTopRight={isOwn ? 0 : 'auto'}
            roundedBottomRight={isOwn ? 18 : 'auto'}
            roundedTopLeft={!isOwn ? 0 : 'auto'}
            roundedBottomLeft={!isOwn ? 18 : 'auto'}
          >
            <Text
              fontSize={{ base: 'sm', md: 'md' }}
              color={isOwn ? 'white' : 'black'}
            >
              {message.content}
            </Text>
          </Box>
        </Tooltip>
      </VStack>
    </HStack>
  );
};

interface MessageListProps {
  fetchMore: () => void;
}

const MessageList = forwardRef<BoxProps & MessageListProps, 'div'>(
  (props, ref) => {
    const { user } = useAuth();
    const messages = useRoomStore((state) => state.messages);
    const membersMap = useRoomStore((state) => state.membersMap);
    const hasMoreMessages = useRoomStore((state) => state.hasMoreMessages);

    return (
      <Box
        id="scrollableDiv"
        w="full"
        overflow="auto"
        display="flex"
        flexDir="column-reverse"
      >
        <InfiniteScroll
          dataLength={messages.length}
          next={props.fetchMore}
          style={{ display: 'flex', flexDirection: 'column-reverse' }} // To put endMessage and loader to the top.
          inverse={true}
          hasMore={hasMoreMessages}
          loader={<CircleLoading size="lg" alignSelf="center" />}
          scrollableTarget="scrollableDiv"
        >
          <Box ref={ref}></Box>
          {messages.map((message: RoomMessage, index: number) => (
            <MessageBox
              key={index}
              message={message}
              isOwn={
                message.creatorId === user?.id || message.creatorId === 'self'
              }
              member={membersMap.get(message.creatorId)}
            />
          ))}
        </InfiniteScroll>
      </Box>
    );
  }
);

export const RoomChatTab: FC = () => {
  const roomId = useRoomStore.getState().roomId;
  const isTheatreMode = useUserSettingsStore((state) => state.isTheatreMode);

  const bottomRef = useRef<any>(null);
  const { isLoading, fetchNextPage } = useInfiniteRoomMessagesQuery(
    'skip',
    {
      skip: 0,
      roomId
    },
    {
      onSuccess(data) {
        const { pages: allMessages } = data;
        const latestIndex = allMessages.length - 1;
        const latestMessages = allMessages[latestIndex].roomMessages;

        setRoomMessages(latestMessages as RoomMessage[]);
      }
    }
  );

  const fetchMoreMessages = async (): Promise<void> => {
    const hasMoreMessages = useRoomStore.getState().hasMoreMessages;
    const totalMessages = useRoomStore.getState().messages.length;

    if (hasMoreMessages) {
      await fetchNextPage({
        pageParam: totalMessages
      });
    }
  };

  const scrollToBottomSection = (): void => {
    bottomRef.current.scrollIntoView({
      block: 'nearest',
      inline: 'start'
    });
  };

  return (
    <VStack
      h={{ base: '614px', lg: isTheatreMode ? '614px' : 'calc(100vh - 188px)' }}
    >
      {isLoading ? (
        <CircleLoading h="full" justifySelf="center" alignSelf="center" />
      ) : (
        <>
          <Flex flex={1} flexDir="column" w="full" overflowY="hidden">
            <MessageList ref={bottomRef} fetchMore={fetchMoreMessages} />
          </Flex>

          <MessageComposer scrollToBottom={scrollToBottomSection} />
        </>
      )}
    </VStack>
  );
};
