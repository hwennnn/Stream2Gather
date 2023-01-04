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

const RoomNoPermission: FC = () => {
  const router = useRouter();

  const backToHome = (): void => {
    void router.push('/');
  };

  return (
    <Layout title="No permission">
      <Modal
        size="md"
        isOpen={true}
        closeOnOverlayClick={false}
        isCentered
        onClose={() => backToHome()}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{'You have no access to this room!'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              You do not have permission to access this room. Do try again after
              asking the owner granting you the right permission!
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

export default RoomNoPermission;
