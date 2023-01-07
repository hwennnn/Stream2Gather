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

const RoomSection: FC = () => {
  return (
    <>
      <Box
        borderRadius="lg"
        mt={{ base: '6', lg: '0' }}
        ml={{ lg: '24px' }}
        width={{ base: '100%', lg: '30%' }}
        bg="bg-surface"
        boxShadow={useColorModeValue('sm', 'sm-dark')}
        p="2"
      >
        <Tabs variant="enclosed" isFitted>
          <TabList>
            <Tab>Playlists</Tab>
            <Tab>Members</Tab>
            <Tab>Chat</Tab>
          </TabList>

          <TabPanels>
            <TabPanel>
              <RoomPlaylistsTab />
            </TabPanel>

            <TabPanel>
              <RoomMembersTab />
            </TabPanel>

            <TabPanel>Chat</TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </>
  );
};

export default RoomSection;
