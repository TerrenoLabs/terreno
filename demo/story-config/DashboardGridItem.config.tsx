import {DemoConfiguration} from "@config";
import {
  DashboardGridItemDefaultStory,
  DashboardGridItemDemo,
} from "@stories/DashboardGridItem.stories";
import {DashboardGridItem} from "@terreno/ui";

export const DashboardGridItemConfiguration: DemoConfiguration = {
  name: "DashboardGridItem",
  component: DashboardGridItem,
  related: ["DashboardGrid", "Card"],
  usageExample: `import {Card, DashboardGrid, DashboardGridItem} from "@terreno/ui";

<DashboardGrid>
  <DashboardGridItem span={{lg: 2, md: 2, sm: 1}}>
    <Card>Wide dashboard tile</Card>
  </DashboardGridItem>
</DashboardGrid>`,
  description:
    "Optional child of DashboardGrid that occupies more than one column. Span is per breakpoint and plain children stay one column.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "notSupported",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "DashboardGridItemProps",
  usage: {
    do: ["Set span when a tile should be wider than its neighbors."],
    doNot: ["Do not wrap every child; plain children already occupy one column."],
  },
  props: {},
  demo: DashboardGridItemDemo,
  demoOptions: {size: "lg"},
  stories: {
    Default: {render: DashboardGridItemDefaultStory},
  },
};
