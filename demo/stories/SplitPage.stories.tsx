import {Box, Heading, SplitPage, Text} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";

interface SplitPageDemoItem {
  id: string;
  name: string;
  summary: string;
}

const LIST_ITEMS: SplitPageDemoItem[] = [
  {id: "inbox", name: "Inbox", summary: "Unread messages and mentions."},
  {id: "docs", name: "Docs", summary: "Guides and API reference."},
  {id: "settings", name: "Settings", summary: "Theme, language, and notifications."},
];

const renderListItem = ({item}: {item: SplitPageDemoItem}): React.ReactElement => {
  return (
    <Box padding={3}>
      <Text bold>{item.name}</Text>
      <Text color="secondaryDark" size="sm">
        {item.summary}
      </Text>
    </Box>
  );
};

export const SplitPageDemo: React.FC = (): React.ReactElement => {
  const renderContent = useCallback((index?: number): React.ReactElement => {
    const item = index === undefined ? undefined : LIST_ITEMS[index];
    if (!item) {
      return (
        <Text>
          Select an item. On large screens the list stays visible; on small screens it is replaced
          by this pane.
        </Text>
      );
    }
    return (
      <Box gap={2}>
        <Heading size="md">{item.name}</Heading>
        <Text>{item.summary}</Text>
      </Box>
    );
  }, []);

  return (
    <Box height={400} width="100%">
      <SplitPage
        listViewData={LIST_ITEMS}
        renderContent={renderContent}
        renderListViewItem={renderListItem}
      />
    </Box>
  );
};

export const SplitPageOptInLayouts: React.FC = (): React.ReactElement => {
  return (
    <Box height={400} width="100%">
      <SplitPage
        desktopChildrenMinWidth={240}
        listViewData={LIST_ITEMS}
        mobileChildLabels={["Summary", "Notes"]}
        mobileListButtonLabel="Back to list"
        renderListViewItem={renderListItem}
      >
        <Box gap={2} padding={3}>
          <Heading size="sm">Summary</Heading>
          <Text>First child. On a wide screen this column stays at least 240 pixels.</Text>
        </Box>
        <Box gap={2} padding={3}>
          <Heading size="sm">Notes</Heading>
          <Text>Second child. On a narrow screen these children page one at a time.</Text>
        </Box>
      </SplitPage>
    </Box>
  );
};

export const SplitPageLoading: React.FC = (): React.ReactElement => {
  const renderContent = useCallback((): React.ReactElement => {
    return <Text>Detail</Text>;
  }, []);

  return (
    <Box gap={2} height={400} width="100%">
      <Heading size="sm">Loading</Heading>
      <SplitPage
        listViewData={LIST_ITEMS}
        loading
        renderContent={renderContent}
        renderListViewItem={renderListItem}
      />
    </Box>
  );
};
