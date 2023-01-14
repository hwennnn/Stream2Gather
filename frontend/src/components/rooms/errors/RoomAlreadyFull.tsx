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

const RoomAlreadyFull: FC = () => {
  const router = useRouter();

  const backToHome = (): void => {
    void router.push('/');
  };

  return (
    <Layout title="Room Already Full">
      <Modal
        size="md"
        isOpen={true}
        closeOnOverlayClick={false}
        isCentered
        onClose={() => backToHome()}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{'The room is already full'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              The room is currently full. Please attempt to join the room later.
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

export default RoomAlreadyFull;
