import { RoomChatTab } from '@app/components/rooms/RoomChatTab';
import { RoomMembersTab } from '@app/components/rooms/RoomMembersTab';
import { RoomPlaylistsTab } from '@app/components/rooms/RoomPlaylistsTab';

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

const RoomSecondarySection: FC = () => {
  return (
    <Box
      position={{ base: 'relative', lg: 'fixed' }}
      top={{ base: 'none', lg: '94px' }}
      right={{
        base: 'none',
        lg: 'calc(max(1rem, (100vw - 120em) / 2 + 1rem))'
      }}
      mt={{ base: '6', lg: '0' }}
      borderRadius="lg"
      width={{ base: '100%', lg: 'sm', xl: 'md' }}
      bg="bg-surface"
      boxShadow={useColorModeValue('sm', 'sm-dark')}
      p="2"
      h={{ base: '700px', lg: 'calc(100vh - 104px)' }}
    >
      <Tabs variant="enclosed" isFitted>
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
