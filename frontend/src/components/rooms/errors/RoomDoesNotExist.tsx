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

const RoomDoesNotExist: FC = () => {
  const router = useRouter();

  const backToHome = (): void => {
    void router.push('/');
  };

  return (
    <Layout title="Room does not exist">
      <Modal
        size="md"
        isOpen={true}
        closeOnOverlayClick={false}
        isCentered
        onClose={() => backToHome()}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{'This room does not exist!'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              Something went wrong. Do create a new room in the homepage to
              start streaming videos!
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

export default RoomDoesNotExist;
