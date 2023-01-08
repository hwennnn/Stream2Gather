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

// position={{ base: 'relative', lg: 'fixed' }}
// float={{ base: 'none', lg: 'right' }}
// ml={{ lg: '70%' }}
// mr={{ lg: '16px' }}
// borderRadius="lg"
// mt={{ base: '6', lg: '0' }}
// // ml={{ lg: '24px' }}
// maxWidth={{ base: '100%', lg: 'lg' }}
// bg="bg-surface"
// boxShadow={useColorModeValue('sm', 'sm-dark')}
// p="2"
// h="calc(100vh - 110px)"

const RoomSection: FC = () => {
  return (
    <>
      <Box
        borderRadius="lg"
        mt={{ base: '6', lg: '0' }}
        ml={{ lg: '24px' }}
        width={{ base: '100%', lg: 'lg' }}
        bg="bg-surface"
        boxShadow={useColorModeValue('sm', 'sm-dark')}
        p="2"
        h="calc(100vh - 110px)"
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
