import { SearchResultSection } from '@app/components/rooms/SearchResultSection';
import { TrendingVideosSection } from '@app/components/rooms/TrendingVideosSection';
import { Box, Tab, TabList, TabPanel, TabPanels, Tabs } from '@chakra-ui/react';
import { FC } from 'react';

export const RoomBelowSection: FC = () => {
  return (
    <Box mt="8">
      <Tabs isFitted variant="enclosed">
        <TabList mb="1em">
          <Tab>Trending Videos</Tab>
          <Tab>Search Result</Tab>
        </TabList>
        <TabPanels overflowY="scroll">
          <TabPanel>
            <TrendingVideosSection />
          </TabPanel>
          <TabPanel>
            <SearchResultSection />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  );
};
