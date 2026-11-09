import {DemoConfiguration} from "@config";
import {
  BarChartDefaultStory,
  BarChartDemo,
  BarChartEmptyStory,
  BarChartZeroNegativeStory,
} from "@stories/BarChart.stories";
import {BarChart} from "@terreno/ui";

export const BarChartConfiguration: DemoConfiguration = {
  usageExample: "import {BarChart} from \"@terreno/ui\";\n\n<BarChart />",
  name: "BarChart",
  component: BarChart,
  related: ["LineChart", "AreaChart", "DashboardGrid"],
  description:
    "Single-series bar chart drawn with owned SVG. Press or hover a bar for `{label}: {value}`. Zero and negative values stay pressable and grow from the zero baseline.",
  a11yNotes: ["Each bar is a clickable Box with an accessibility label of `{label}: {value}`."],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "notSupported",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "BarChartProps",
  usage: {
    do: ["Pass a single series of `{label, value}` points."],
    doNot: ["Do not pass stacked or grouped multi-series data."],
  },
  props: {},
  demo: BarChartDemo,
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
    Default: {render: BarChartDefaultStory},
    Empty: {render: BarChartEmptyStory},
    "Zero and negative": {render: BarChartZeroNegativeStory},
  },
};
