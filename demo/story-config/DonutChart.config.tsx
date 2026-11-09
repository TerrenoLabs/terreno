import {DemoConfiguration} from "@config";
import {
  DonutChartDefaultStory,
  DonutChartDemo,
  DonutChartEmptyStory,
} from "@stories/DonutChart.stories";
import {DonutChart} from "@terreno/ui";

export const DonutChartConfiguration: DemoConfiguration = {
  usageExample: "import {DonutChart} from \"@terreno/ui\";\n\n<DonutChart />",
  name: "DonutChart",
  component: DonutChart,
  related: ["LineChart", "BarChart", "DashboardGrid"],
  description:
    "Single-series donut chart. One slice per point; optional per-slice color; legend is one row per slice.",
  a11yNotes: ["Each slice mark is a clickable Box with `{label}: {value}`."],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "notSupported",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "DonutChartProps",
  usage: {
    do: ["Pass `{label, value}` slices. Set `color` on a point to override theme paint."],
    doNot: ["Do not use legendLabel — the legend is always one row per slice."],
  },
  props: {},
  demo: DonutChartDemo,
  demoOptions: {
    size: "lg",
    controls: {
      loading: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  stories: {
    Default: {render: DonutChartDefaultStory},
    Empty: {render: DonutChartEmptyStory},
  },
};
