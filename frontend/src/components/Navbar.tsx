import { MoonIcon, SunIcon } from '@chakra-ui/icons';
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
import { firebaseLogout } from '../auth/firebaseAuth';
import { MeQueryKey } from '../constants/query';
import { useAuth } from '../contexts/AuthContext';
import { useLogoutMutation } from '../generated/graphql';
import { queryClient } from '../pages/_app';

const UserMenu: FC = () => {
  const { user } = useAuth();
  const { mutateAsync } = useLogoutMutation({});

  const logout = async (): Promise<void> => {
    const result = await mutateAsync({});
    if (result.logout) {
      await firebaseLogout();
      await queryClient.invalidateQueries({ queryKey: MeQueryKey });
      await router.push('/');
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
          size={'sm'}
          src={`https://avatars.dicebear.com/api/pixel-art/${
            user?.username ?? ''
          }.svg`}
        />
      </MenuButton>

      <MenuList alignItems={'center'}>
        <br />
        <Center>
          <Avatar
            size={'2xl'}
            src={`https://avatars.dicebear.com/api/pixel-art/${
              user?.username ?? ''
            }.svg`}
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
      spacing={6}
    >
      <Button fontSize={'md'} fontWeight={400} variant={'link'}>
        <Link href="/login">Sign In</Link>
      </Button>
      <Button
        display={{ base: 'none', md: 'inline-flex' }}
        fontSize={'md'}
        fontWeight={600}
        color={'white'}
        bg={'secondary'}
        _hover={{
          opacity: 0.8
        }}
      >
        <Link href="/register">Sign Up</Link>
      </Button>
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
        bg={useColorModeValue('gray.100', 'primary')}
        borderBottom={1}
        borderStyle={'solid'}
        borderColor={useColorModeValue('gray.200', 'gray.900')}
        px={4}
      >
        <Flex h={16} alignItems={'center'} justifyContent={'space-between'}>
          <Box>
            <Link href="/">
              <Text
                fontFamily={'heading'}
                fontWeight={'bold'}
                fontSize={'lg'}
                color={useColorModeValue('gray.800', 'white')}
              >
                Stream2Gather
              </Text>
            </Link>
          </Box>

          <Flex alignItems={'center'}>
            <Stack direction={'row'} spacing={7}>
              <Button onClick={toggleColorMode}>
                {colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
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
