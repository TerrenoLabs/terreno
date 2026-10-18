import {Box, Heading, SplitPage, Text} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";

interface BoundedColumnProps {
  title: string;
}

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
        narrowViewportChildLabels={["Summary", "Notes"]}
        narrowViewportListButtonLabel="Back to list"
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

export const SplitPageNarrowBelowWidth: React.FC = (): React.ReactElement => {
  return (
    <Box height={400} width="100%">
      <SplitPage
        desktopChildrenMinWidth={200}
        listViewData={LIST_ITEMS}
        narrowBelowWidth={500}
        narrowViewportChildLabels={["Summary", "Notes"]}
        narrowViewportListButtonLabel="Back to list"
        renderListViewItem={renderListItem}
      >
        <Box gap={2} padding={3}>
          <Heading size="sm">Summary</Heading>
          <Text>This layout uses the narrow pager at 500 pixels and below.</Text>
        </Box>
        <Box gap={2} padding={3}>
          <Heading size="sm">Notes</Heading>
          <Text>Above 500 pixels, the list and both children stay side by side.</Text>
        </Box>
      </SplitPage>
    </Box>
  );
};

const columnLines = (label: string, count = 24): React.ReactElement[] => {
  return Array.from({length: count}, (_, index) => {
    const lineNumber = index + 1;
    return <Text key={`${label}-${lineNumber}`}>{`${label} line ${lineNumber}`}</Text>;
  });
};

export const SplitPageTallDesktopColumns: React.FC = (): React.ReactElement => {
  return (
    <Box height={420} width="100%">
      <SplitPage
        childColumnRounding="lg"
        listViewData={LIST_ITEMS}
        renderListViewItem={renderListItem}
      >
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Primary</Heading>
          {columnLines("Primary")}
          <Text>Primary end</Text>
        </Box>
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Secondary</Heading>
          {columnLines("Secondary")}
          <Text>Secondary end</Text>
        </Box>
      </SplitPage>
    </Box>
  );
};

export const SplitPageTallMinWidthColumns: React.FC = (): React.ReactElement => {
  return (
    <Box height={420} width="100%">
      <SplitPage
        childColumnRounding="lg"
        desktopChildrenMinWidth={280}
        listViewData={LIST_ITEMS}
        renderListViewItem={renderListItem}
      >
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Left</Heading>
          {columnLines("Left")}
          <Text>Left end</Text>
        </Box>
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Right</Heading>
          {columnLines("Right")}
          <Text>Right end</Text>
        </Box>
      </SplitPage>
    </Box>
  );
};

export const SplitPageTallSegmentedColumns: React.FC = (): React.ReactElement => {
  return (
    <Box height={420} width="100%">
      <SplitPage
        childColumnRounding="lg"
        listViewData={LIST_ITEMS}
        renderListViewItem={renderListItem}
        tabs={["Overview", "Activity", "Notes"]}
      >
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Overview</Heading>
          {columnLines("Overview")}
          <Text>Overview end</Text>
        </Box>
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Activity</Heading>
          {columnLines("Activity")}
          <Text>Activity end</Text>
        </Box>
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Notes</Heading>
          {columnLines("Notes")}
          <Text>Notes end</Text>
        </Box>
      </SplitPage>
    </Box>
  );
};

const BoundedColumn: React.FC<BoundedColumnProps> = ({title}): React.ReactElement => {
  return (
    <Box color="base" height="100%" width="100%">
      <Box color="secondaryLight" padding={3}>
        <Heading size="sm">{title}</Heading>
        <Text>This header stays in the pane.</Text>
      </Box>
      <Box flex="grow" padding={3} scroll>
        {columnLines(title)}
        <Text>{`${title} notes end`}</Text>
      </Box>
    </Box>
  );
};

export const SplitPageBoundedInternalScroll: React.FC = (): React.ReactElement => {
  return (
    <Box height={420} width="100%">
      <SplitPage
        childColumnRounding="lg"
        desktopChildrenMinWidth={280}
        listViewData={LIST_ITEMS}
        renderListViewItem={renderListItem}
      >
        <BoundedColumn title="Details" />
        <BoundedColumn title="History" />
      </SplitPage>
    </Box>
  );
};

export const SplitPageMinWidthHorizontal: React.FC = (): React.ReactElement => {
  return (
    <Box height={360} width={720}>
      <SplitPage
        desktopChildrenMinWidth={360}
        listViewData={LIST_ITEMS}
        renderListViewItem={renderListItem}
      >
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Left column</Heading>
          <Text>This column stays at least 360 pixels wide.</Text>
        </Box>
        <Box color="base" gap={2} padding={3}>
          <Heading size="sm">Right column</Heading>
          <Text>Scroll the row sideways to reach this column.</Text>
        </Box>
      </SplitPage>
    </Box>
  );
};

export const SplitPageNarrowLabeledScroll: React.FC = (): React.ReactElement => {
  return (
    <Box flex="grow" height="100%" width="100%">
      <SplitPage
        childColumnRounding="lg"
        listViewData={LIST_ITEMS}
        narrowBelowWidth={4000}
        narrowViewportChildLabels={["Summary", "Notes", "History"]}
        narrowViewportListButtonLabel="Back to list"
        renderListViewItem={renderListItem}
        tabs={["Summary", "Notes", "History"]}
      >
        <Box color="base" height="100%" width="100%">
          <Box padding={3}>
            <Heading size="sm">Summary</Heading>
            <Text>Labeled pager. This header stays put.</Text>
          </Box>
          <Box flex="grow" padding={3} scroll>
            {columnLines("Summary", 40)}
            <Text>Summary end</Text>
          </Box>
        </Box>
        <Box color="base" height="100%" width="100%">
          <Box padding={3}>
            <Heading size="sm">Notes</Heading>
            <Text>Short column. The pane stays the same height.</Text>
          </Box>
        </Box>
        <Box color="base" height="100%" width="100%">
          <Box padding={3}>
            <Heading size="sm">History</Heading>
          </Box>
          <Box flex="grow" padding={3} scroll>
            {columnLines("History", 40)}
            <Text>History end</Text>
          </Box>
        </Box>
      </SplitPage>
    </Box>
  );
};

export const SplitPageNarrowDottedScroll: React.FC = (): React.ReactElement => {
  return (
    <Box height={420} width="100%">
      <SplitPage
        childColumnRounding="lg"
        listViewData={LIST_ITEMS}
        narrowBelowWidth={4000}
        renderListViewItem={renderListItem}
      >
        <Box color="base" height="100%" width="100%">
          <Box padding={3}>
            <Heading size="sm">Dotted page</Heading>
            <Text>Dotted swiper. This header stays put.</Text>
          </Box>
          <Box flex="grow" padding={3} scroll>
            {columnLines("Dotted")}
            <Text>Dotted end</Text>
          </Box>
        </Box>
        <Box color="base" padding={3}>
          <Heading size="sm">Second page</Heading>
          <Text>Swipe or use the dots to reach this page.</Text>
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
