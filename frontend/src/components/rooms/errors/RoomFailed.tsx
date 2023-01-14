import Layout from '@app/components/common/layouts/Layout';
import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text
} from '@chakra-ui/react';
import { useRouter } from 'next/router';
import { FC } from 'react';

const RoomFailed: FC = () => {
  const router = useRouter();

  const backToHome = (): void => {
    void router.push('/');
  };

  return (
    <Layout title="Join Room Failed">
      <Modal
        size="md"
        isOpen={true}
        closeOnOverlayClick={false}
        isCentered
        onClose={() => backToHome()}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{'Errors while joining room'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              There are errors while joining the room. Please attempt to join
              the room again.
            </Text>
          </ModalBody>

          <ModalFooter>
            <Button colorScheme="blue" mr={3} onClick={() => backToHome()}>
              Back to Home
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Layout>
  );
};

export default RoomFailed;
