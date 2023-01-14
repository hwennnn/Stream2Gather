/* eslint-disable react/no-children-prop */
import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { useAuth } from '@app/contexts/AuthContext';
import { useRoomMessagesQuery } from '@app/generated/graphql';
import { sendMessage } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import useRoomStore, {
  RoomMessage,
  setRoomMessages
} from '@app/store/useRoomStore';
import { formatMsToMinutesSeconds } from '@app/utils/formatDatetime';
import {
  Box,
  Flex,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  VStack
} from '@chakra-ui/react';
import { FC, useEffect, useRef, useState } from 'react';
import { IoMdSend } from 'react-icons/io';

const AlwaysScrollToBottom: FC = () => {
  const elementRef = useRef<any>();
  useEffect(() => {
    elementRef.current?.scrollIntoView();
  });
  return <Box ref={elementRef} />;
};

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
            maxLength={128}
            placeholder="Enter a message"
          />
          <InputRightElement
            children={<IoMdSend type="submit" onClick={submitForm} />}
          />
        </InputGroup>
      </form>
    </Box>
  );
};

const MessageBox: FC<{ message: RoomMessage; isOwn: boolean }> = ({
  message,
  isOwn
}) => {
  return (
    <Flex
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
    </Flex>
  );
};

export const RoomChatTab: FC = () => {
  const { user } = useAuth();
  const slug = useRoomStore.getState().roomSlug;
  const messages = useRoomStore((state) => state.messages);

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
          <VStack w="full" spacing={4}>
            {messages.map((message) => (
              <MessageBox
                key={message.id}
                message={message}
                isOwn={message.creatorId === user?.id}
              />
            ))}
            <AlwaysScrollToBottom />
          </VStack>
        </Flex>
        <MessageComposer />
      </VStack>
    </>
  );
};
