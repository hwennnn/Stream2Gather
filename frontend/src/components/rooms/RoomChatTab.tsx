/* eslint-disable react/no-children-prop */
import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { useRoomMessagesQuery } from '@app/generated/graphql';
import { sendMessage } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import useRoomStore, {
  RoomMessage,
  setRoomMessages
} from '@app/store/useRoomStore';
import {
  Box,
  Flex,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  VStack
} from '@chakra-ui/react';
import { FC, useState } from 'react';
import { IoMdSend } from 'react-icons/io';

// const AlwaysScrollToBottom: FC = () => {
//   const elementRef = useRef<any>();
//   useEffect(() => {
//     if (elementRef.current !== undefined) {
//       elementRef.current.scrollIntoView({ behavior: 'smooth' });
//     }
//   });
//   return <Box ref={elementRef} />;
// };

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

export const RoomChatTab: FC = () => {
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
      <VStack
        h={{ base: '614px', lg: 'calc(100vh - 188px)' }}
        overflowY="scroll"
      >
        <Flex flexDirection="column" flex={1}>
          {messages.map((message) => (
            <Text key={message.id}>{message.content}</Text>
          ))}
        </Flex>
        <MessageComposer />
        {/* <AlwaysScrollToBottom /> */}
      </VStack>
    </>
  );
};
