/* eslint-disable react/no-children-prop */
import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { useAuth } from '@app/contexts/AuthContext';
import {
  RoomMemberFragment,
  useRoomMessagesQuery
} from '@app/generated/graphql';
import { sendMessage } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import useRoomStore, {
  RoomMessage,
  setRoomMessages
} from '@app/store/useRoomStore';
import { formatMsToMinutesSeconds } from '@app/utils/formatDatetime';
import {
  Avatar,
  Box,
  Flex,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  VStack
} from '@chakra-ui/react';
import { FC, useEffect, useRef, useState } from 'react';
import { IoMdSend } from 'react-icons/io';

const MessageComposer: FC = () => {
  const { socket } = useRoomContext();
  const [message, setMessage] = useState('');

  const submitForm = (): void => {
    if (message.length > 0) {
      sendMessage(socket, message);
      setMessage('');
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
            fontSize="lg"
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
    <HStack w="full">
      {
        !isOwn && (
          <Avatar
            alignSelf="start"
            name={member?.username ?? 'Deleted User'}
            size={'sm'}
            src={member?.displayPhoto ?? undefined}
          />
        )
        // <Text>{member.username}</Text>
      }
      <VStack
        w="full"
        flexDirection="column"
        alignItems={isOwn ? 'flex-end' : 'flex-start'}
      >
        <Box
          maxW="70%"
          px="4"
          py="2"
          backgroundColor={isOwn ? 'secondary' : 'gray.200'}
          rounded={20}
          roundedTopRight={isOwn ? 0 : 'auto'}
          roundedBottomRight={isOwn ? 18 : 'auto'}
          roundedTopLeft={!isOwn ? 0 : 'auto'}
          roundedBottomLeft={!isOwn ? 18 : 'auto'}
        >
          <Text color={isOwn ? 'white' : 'black'}>{message.content}</Text>
        </Box>
        <Text mt="0.5" fontSize="xs">
          {formatMsToMinutesSeconds(message.createdAt)}
        </Text>
      </VStack>
    </HStack>
  );
};

const MessageList: FC = () => {
  const { user } = useAuth();
  const messages = useRoomStore((state) => state.messages);
  const membersMap = useRoomStore((state) => state.membersMap);

  const bottomRef = useRef<any>(null);

  useEffect(() => {
    const { scrollX, scrollY } = window;

    bottomRef.current?.scrollIntoView();

    window.scrollTo(scrollX, scrollY);
  }, [messages]);

  return (
    <VStack w="full" spacing={4}>
      {messages.map((message) => (
        <MessageBox
          key={message.id}
          message={message}
          isOwn={message.creatorId === user?.id}
          member={membersMap.get(message.creatorId)}
        />
      ))}
      <Box ref={bottomRef} />
    </VStack>
  );
};

export const RoomChatTab: FC = () => {
  const slug = useRoomStore.getState().roomSlug;

  const { isLoading } = useRoomMessagesQuery(
    { slug },
    {
      onSuccess(data) {
        setRoomMessages(data.roomMessages as RoomMessage[]);
      }
    }
  );

  if (isLoading === true) return <CircleLoading />;

  return (
    <>
      <VStack px="1" h={{ base: '614px', lg: 'calc(100vh - 188px)' }}>
        <Flex w="full" flexDirection="column" overflowY="scroll" flex={1}>
          <MessageList />
        </Flex>
        <MessageComposer />
      </VStack>
    </>
  );
};
