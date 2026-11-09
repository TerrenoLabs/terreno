import {DemoConfiguration} from "@config";
import {
  LineChartDefaultStory,
  LineChartDemo,
  LineChartEmptyStory,
  LineChartLoadingStory,
  LineChartTooltipStory,
} from "@stories/LineChart.stories";
import {LineChart} from "@terreno/ui";

export const LineChartConfiguration: DemoConfiguration = {
  usageExample: "import {LineChart} from \"@terreno/ui\";\n\n<LineChart />",
  name: "LineChart",
  component: LineChart,
  related: ["DashboardGrid", "BarChart", "AreaChart"],
  description:
    "Single-series line chart drawn with owned SVG. Press or hover a point for `{label}: {value}`. Empty data shows empty copy; loading shows a spinner.",
  a11yNotes: [
    "Each point is a clickable Box with an accessibility label of `{label}: {value}`.",
    "The chart summary uses accessibilityLabel or `{legendLabel} line chart`.",
  ],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "notSupported",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "LineChartProps",
  usage: {
    do: [
      "Pass a single series of `{label, value}` points.",
      "Set legendLabel when the series needs a name under the plot.",
    ],
    doNot: [
      "Do not pass stacked or multi-series data.",
      "Do not import d3 or victory-native from app code.",
    ],
  },
  props: {},
  demo: LineChartDemo,
  demoOptions: {
    size: "lg",
    controls: {
      loading: {
        type: "boolean",
        defaultValue: false,
      },
      legendLabel: {
        type: "text",
        defaultValue: "Signups",
      },
    },
  },
  stories: {
    Default: {render: LineChartDefaultStory},
    Empty: {render: LineChartEmptyStory},
    Loading: {render: LineChartLoadingStory},
    Tooltip: {render: LineChartTooltipStory},
  },
};
