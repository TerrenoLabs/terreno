import type {DemoConfiguration} from "@config";
import {
  SplitPageDemo,
  SplitPageLoading,
  SplitPageNarrowBelowWidth,
  SplitPageOptInLayouts,
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
  },
};
