import { firebaseLogout } from '@app/auth/firebaseAuth';
import { Logo } from '@app/components/common/Logo';
import { MeQueryKey } from '@app/constants/query';
import { useAuth } from '@app/contexts/AuthContext';
import { useLogoutMutation } from '@app/generated/graphql';
import { queryClient } from '@app/pages/_app';
import { resetUserSettings } from '@app/store/useUserSettingsStore';
import {
  Avatar,
  Box,
  Button,
  Center,
  Flex,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Stack,
  Text,
  useColorMode,
  useColorModeValue
} from '@chakra-ui/react';
import Link from 'next/link';
import router from 'next/router';
import { FC } from 'react';
import { RiMoonClearFill, RiSunLine } from 'react-icons/ri';

const UserMenu: FC = () => {
  const { user } = useAuth();
  const { mutateAsync } = useLogoutMutation({});

  const logout = async (): Promise<void> => {
    const result = await mutateAsync({});
    if (result.logout) {
      await firebaseLogout();
      await queryClient.invalidateQueries({ queryKey: MeQueryKey });
      await router.push('/');
      resetUserSettings();
    }
  };

  return (
    <Menu>
      <MenuButton
        as={Button}
        rounded={'full'}
        variant={'link'}
        cursor={'pointer'}
        minW={0}
      >
        <Avatar
          name={user?.username}
          size={'sm'}
          src={user?.displayPhoto ?? undefined}
        />
      </MenuButton>

      <MenuList alignItems={'center'}>
        <br />
        <Center>
          <Avatar
            name={user?.username}
            size={'xl'}
            src={user?.displayPhoto ?? undefined}
          />
        </Center>
        <br />
        <Center>
          <Text fontSize={'md'} fontWeight={'semibold'}>
            {user?.username ?? ''}
          </Text>
        </Center>
        <br />
        <MenuDivider />
        <MenuItem>Edit Profile</MenuItem>
        <MenuItem>Account Settings</MenuItem>
        <MenuItem onClick={async () => await logout()}>Logout</MenuItem>
      </MenuList>
    </Menu>
  );
};

const LoginItems: FC = () => {
  return (
    <Stack
      flex={{ base: 1, md: 0 }}
      justify={'flex-end'}
      direction={'row'}
      alignItems={'center'}
      spacing={6}
    >
      <Link href="/login">
        <Button fontSize={'md'} fontWeight={500} variant={'link'}>
          Log In
        </Button>
      </Link>

      <Link href="/register">
        <Button
          variant="primary"
          display={{ base: 'none', md: 'inline-flex' }}
          fontSize={'md'}
          fontWeight={600}
        >
          Register
        </Button>
      </Link>
    </Stack>
  );
};

const Navbar: FC = () => {
  const { colorMode, toggleColorMode } = useColorMode();
  const { user } = useAuth();

  const isLoggedIn = user !== undefined && user !== null;

  return (
    <>
      <Box
        as="header"
        position="fixed"
        w="full"
        bg="bg-surface"
        zIndex="2"
        boxShadow={useColorModeValue('sm', 'sm-dark')}
        py={1}
      >
        <Flex
          h={16}
          alignItems={'center'}
          justifyContent={'space-between'}
          mx="auto"
          px={4}
          maxW="120em"
        >
          <Link href="/">
            <Flex justifyItems={'center'} alignItems="center" direction={'row'}>
              <Logo mr="2" height="10" />
              <Text
                fontFamily={'heading'}
                fontWeight={'bold'}
                fontSize={'lg'}
                color={'accent'}
              >
                Stream2Gather
              </Text>
            </Flex>
          </Link>

          <Flex alignItems={'center'}>
            <Stack direction={'row'} spacing={6}>
              <Button p={2} background={'none'} onClick={toggleColorMode}>
                {colorMode === 'light' ? <RiMoonClearFill /> : <RiSunLine />}
              </Button>

              {isLoggedIn ? <UserMenu /> : <LoginItems />}
            </Stack>
          </Flex>
        </Flex>
      </Box>
    </>
  );
};

export default Navbar;
