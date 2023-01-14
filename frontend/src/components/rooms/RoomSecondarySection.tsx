import { RoomChatTab } from '@app/components/rooms/RoomChatTab';
import { RoomMembersTab } from '@app/components/rooms/RoomMembersTab';
import { RoomPlaylistsTab } from '@app/components/rooms/RoomPlaylistsTab';
import useUserSettingsStore from '@app/store/useUserSettingsStore';

import {
  Box,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  useColorModeValue
} from '@chakra-ui/react';
import { FC } from 'react';
import shallow from 'zustand/shallow';

const RoomSecondarySection: FC = () => {
  const { isTheatreMode } = useUserSettingsStore(
    (state) => ({
      isTheatreMode: state.isTheatreMode
    }),
    shallow
  );

  return (
    <Box
      position={{ base: 'relative', lg: isTheatreMode ? 'relative' : 'fixed' }}
      top={{ base: 'none', lg: isTheatreMode ? 'none' : '94px' }}
      right={{
        base: 'none',
        lg: isTheatreMode
          ? 'none'
          : 'calc(max(1rem, (100vw - 120em) / 2 + 1rem))'
      }}
      mt={{ base: '6', lg: isTheatreMode ? '6' : '0' }}
      borderRadius="lg"
      width={{
        base: '100%',
        lg: isTheatreMode ? '100%' : 'sm',
        xl: isTheatreMode ? '100%' : 'md'
      }}
      bg="bg-surface"
      boxShadow={useColorModeValue('sm', 'sm-dark')}
      p="2"
      h={{ base: '700px', lg: isTheatreMode ? '700px' : 'calc(100vh - 104px)' }}
    >
      <Tabs defaultIndex={2} variant="enclosed" isFitted>
        <TabList>
          <Tab>Playlists</Tab>
          <Tab>Members</Tab>
          <Tab>Chat</Tab>
        </TabList>

        <TabPanels>
          <TabPanel px="0">
            <RoomPlaylistsTab />
          </TabPanel>

          <TabPanel px="0">
            <RoomMembersTab />
          </TabPanel>

          <TabPanel px="0">
            <RoomChatTab />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  );
};

export default RoomSecondarySection;
