import { SearchResultSection } from '@app/components/rooms/SearchResultSection';
import { TrendingVideosSection } from '@app/components/rooms/TrendingVideosSection';
import useRoomStore, {
  setCurrentVideoResultTab,
  VideoResultTab
} from '@app/store/useRoomStore';
import { Box, Tab, TabList, TabPanel, TabPanels, Tabs } from '@chakra-ui/react';
import { FC } from 'react';

export const RoomBelowSection: FC = () => {
  const videoResultTab = useRoomStore((state) => state.currentVideoResultTab);

  const handleTabsChange = (index: number): void => {
    setCurrentVideoResultTab(
      index === 0
        ? VideoResultTab.TRENDING_VIDEOS
        : VideoResultTab.SEARCH_RESULTS
    );
  };

  return (
    <Box mt="8">
      <Tabs
        onChange={handleTabsChange}
        index={videoResultTab}
        isFitted
        variant="enclosed"
      >
        <TabList mb="1em">
          <Tab>Trending Videos</Tab>
          <Tab>Search Results</Tab>
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
