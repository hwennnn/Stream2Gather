import { Box, Button, Flex, HStack, Spacer, Text } from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FC } from 'react';
import { firebaseLogout } from '../auth/firebaseAuth';
import { MeQueryKey } from '../constants/query';
import { useAuth } from '../contexts/AuthContext';

import { useLogoutMutation } from '../generated/graphql';
import { PrimaryButton } from './ui/buttons/PrimaryButton';
import { ThemeToggler } from './ui/theme/ThemeToggler';

const Navbar: FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { user } = useAuth();

  const { mutateAsync } = useLogoutMutation({});

  const isLoggedIn = user !== undefined && user !== null;

  const logout = async (): Promise<void> => {
    const result = await mutateAsync({});
    if (result.logout) {
      await firebaseLogout();
      await queryClient.invalidateQueries({ queryKey: MeQueryKey });
      await router.push('/');
    }
  };

  return (
    <Flex direction="row" px="8" py="4">
      <Box>
        {/* ADD APP ICON HERE */}
        <Link href="/">
          <Text fontSize="xl" fontWeight="bold">
            Stream2Gather
          </Text>
        </Link>
      </Box>

      <Spacer />

      <HStack spacing="12px">
        <ThemeToggler />
        {isLoggedIn && (
          <>
            <Text fontSize="l" fontWeight={'semibold'}>
              {user?.username}
            </Text>

            <PrimaryButton title="Logout" onClick={logout} />
          </>
        )}

        {!isLoggedIn && (
          <>
            <Link href="/login">
              <Button minWidth={'100px'} size="md" colorScheme="blue">
                Login
              </Button>
            </Link>

            <Link href="/register">
              <Button minWidth={'100px'} size="md" colorScheme="blue">
                Register
              </Button>
            </Link>
          </>
        )}
      </HStack>
    </Flex>
  );
};

export default Navbar;
