import type {DemoConfiguration} from "@config";
import {
  SplitPageBoundedInternalScroll,
  SplitPageDemo,
  SplitPageLoading,
  SplitPageMinWidthHorizontal,
  SplitPageNarrowBelowWidth,
  SplitPageNarrowDottedScroll,
  SplitPageNarrowLabeledScroll,
  SplitPageOptInLayouts,
  SplitPageTallDesktopColumns,
  SplitPageTallMinWidthColumns,
  SplitPageTallSegmentedColumns,
} from "@stories/SplitPage.stories";
import {SplitPage} from "@terreno/ui";

export const SplitPageConfiguration: DemoConfiguration = {
  usageExample: "import {SplitPage} from \"@terreno/ui\";\n\n<SplitPage />",
  name: "SplitPage",
  component: SplitPage,
  related: ["Page", "Box"],
  description:
    "Master-detail layout. On large screens the list and detail sit side by side. On small screens, selecting a list item replaces the list with the detail pane. On web, opt in to a minimum column width, a labeled narrow pager, or a custom shrink width.",
  a11yNotes: ["List items must be activatable. The narrow-viewport back control must remain labeled."],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "SplitPageProps",
  usage: {
    do: [
      "Pass listViewData with stable id fields and renderListViewItem.",
      "Use renderContent for the detail pane.",
    ],
    doNot: ["Do not pass master/detail props — those are not part of the public API."],
  },
  props: {},
  demo: () => <SplitPageDemo />,
  demoOptions: {size: "lg"},
  stories: {
    Loading: {
      description: "Loading spinner instead of list and detail.",
      render: () => <SplitPageLoading />,
    },
    OptInLayouts: {
      description:
        "Web only. Desktop children keep a minimum column width. The narrow viewport uses a labeled pager with a return-to-list button.",
      render: () => <SplitPageOptInLayouts />,
    },
    NarrowBelowWidth: {
      description:
        "Web only. narrowBelowWidth={500} uses the narrow layout at 500 pixels and below. Above 500 pixels the list and children stay side by side.",
      render: () => <SplitPageNarrowBelowWidth />,
    },
    "Tall desktop columns": {
      description:
        "Desktop row. Each child is taller than the pane, scrolls on its own, and keeps rounded corners.",
      render: () => <SplitPageTallDesktopColumns />,
    },
    "Tall min-width columns": {
      description:
        "desktopChildrenMinWidth columns. Each child scrolls vertically inside a rounded pane.",
      render: () => <SplitPageTallMinWidthColumns />,
    },
    "Tall segmented columns": {
      description: "More than two children. The visible segmented columns scroll vertically.",
      render: () => <SplitPageTallSegmentedColumns />,
    },
    "Bounded internal scroll": {
      description:
        "A height 100% child fills the pane. Its header stays put and its own scroll view moves.",
      render: () => <SplitPageBoundedInternalScroll />,
    },
    "Min-width horizontal scroll": {
      description:
        "The children row scrolls sideways when it is narrower than the combined minimum widths.",
      render: () => <SplitPageMinWidthHorizontal />,
    },
    "Narrow labeled scroll": {
      description:
        "Labeled narrow pager. Previous and next stay in a row under the column. Select a list item first.",
      render: () => <SplitPageNarrowLabeledScroll />,
    },
    "Narrow dotted scroll": {
      description:
        "Dotted narrow swiper. The page stays clipped and the child scrolls inside it. Select a list item first.",
      render: () => <SplitPageNarrowDottedScroll />,
    },
  },
};
