/* eslint-disable react/no-children-prop */
import { firebaseLogout } from '@app/auth/firebaseAuth';
import { Logo } from '@app/components/common/Logo';
import { MeQueryKey } from '@app/constants/query';
import { useAuth } from '@app/contexts/AuthContext';
import { useLogoutMutation } from '@app/generated/graphql';
import { addVideoIdToPlaylist } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import { queryClient } from '@app/pages/_app';
import useRoomStore, {
  setCurrentVideoResultTab,
  setSearchQuery,
  VideoResultTab
} from '@app/store/useRoomStore';
import { resetUserSettings } from '@app/store/useUserSettingsStore';
import { parseYoutubeUrl } from '@app/utils/parseYoutubeUrl';
import { SearchIcon } from '@chakra-ui/icons';
import {
  Avatar,
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
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
import { FC, useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { RiMoonClearFill, RiSunLine } from 'react-icons/ri';
import ReactPlayer from 'react-player';

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

const InvitationButton: FC = () => {
  const { roomSlug, invitationCode, isPublic } = useRoomStore.getState();
  const [isCopied, setIsCopied] = useState(false);
  let invitationUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/room/${roomSlug}`;

  if (!isPublic) {
    invitationUrl += `?invitationCode=${invitationCode}`;
  }

  return (
    <Box display={{ base: 'none', md: 'block' }}>
      <CopyToClipboard
        text={invitationUrl}
        onCopy={() => {
          setIsCopied(true);
          setTimeout(() => {
            setIsCopied(false);
          }, 1500);
        }}
      >
        <Button
          width="100px"
          disabled={isCopied}
          px="3"
          fontWeight="semibold"
          fontSize="sm"
          colorScheme="brand"
        >
          {isCopied ? 'Copied!' : 'Copy Invite'}
        </Button>
      </CopyToClipboard>
    </Box>
  );
};

const SearchBox: FC = () => {
  const { socket } = useRoomContext();
  const [searchValue, setSearchValue] = useState('');

  const submitForm = (): void => {
    if (searchValue.length > 0) {
      if (ReactPlayer.canPlay(searchValue)) {
        const videoId = parseYoutubeUrl(searchValue);
        if (videoId !== null) {
          addVideoIdToPlaylist(socket, videoId);
        }
        setSearchValue('');
      } else {
        setSearchQuery(searchValue);
        setCurrentVideoResultTab(VideoResultTab.SEARCH_RESULTS);
      }
    }
  };

  return (
    <HStack
      display={{ base: 'none', md: 'block' }}
      width={{ md: '260px', lg: 'xs', xl: 'sm', '2xl': 'lg' }}
    >
      <form
        onSubmit={(event) => {
          submitForm();
          event.preventDefault();
        }}
      >
        <InputGroup>
          <Input
            type="text"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value);
            }}
            maxLength={50}
            placeholder="Search or Paste a Link"
          />
          <InputRightElement
            children={<SearchIcon type="submit" onClick={submitForm} />}
          />
        </InputGroup>
      </form>
    </HStack>
  );
};

const RoomNavbar: FC = () => {
  const { colorMode, toggleColorMode } = useColorMode();

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

          <SearchBox />

          <Flex alignItems={'center'}>
            <Stack direction={'row'} spacing={6}>
              <InvitationButton />
              <Button p={2} background={'none'} onClick={toggleColorMode}>
                {colorMode === 'light' ? <RiMoonClearFill /> : <RiSunLine />}
              </Button>

              <UserMenu />
            </Stack>
          </Flex>
        </Flex>
      </Box>
    </>
  );
};

export default RoomNavbar;
