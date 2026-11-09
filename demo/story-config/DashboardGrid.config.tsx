import {DemoConfiguration} from "@config";
import {DashboardGridDefaultStory, DashboardGridDemo} from "@stories/DashboardGrid.stories";
import {DashboardGrid} from "@terreno/ui";

export const DashboardGridConfiguration: DemoConfiguration = {
  usageExample: "import {DashboardGrid} from \"@terreno/ui\";\n\n<DashboardGrid />",
  name: "DashboardGrid",
  component: DashboardGrid,
  related: ["Card", "LineChart", "BarChart"],
  description:
    "Responsive wrapping grid for dashboard tiles. Callers supply Card children; default columns are `{sm: 1, md: 2, lg: 3}`.",
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
  interfaceName: "DashboardGridProps",
  usage: {
    do: ["Wrap `Card` children. Put a chart inside each card."],
    doNot: ["Do not invent a DashboardCard — reuse Card."],
  },
  props: {},
  demo: DashboardGridDemo,
  demoOptions: {size: "lg"},
  stories: {
    Default: {render: DashboardGridDefaultStory},
  },
};
