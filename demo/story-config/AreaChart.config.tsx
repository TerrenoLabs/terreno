import {DemoConfiguration} from "@config";
import {AreaChartDefaultStory, AreaChartDemo, AreaChartEmptyStory} from "@stories/AreaChart.stories";
import {AreaChart} from "@terreno/ui";

export const AreaChartConfiguration: DemoConfiguration = {
  usageExample: "import {AreaChart} from \"@terreno/ui\";\n\n<AreaChart />",
  name: "AreaChart",
  component: AreaChart,
  related: ["LineChart", "BarChart", "DashboardGrid"],
  description:
    "Single-series area chart drawn with owned SVG. Press or hover a point for `{label}: {value}`.",
  a11yNotes: ["Each point is a clickable Box with an accessibility label of `{label}: {value}`."],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "notSupported",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "AreaChartProps",
  usage: {
    do: ["Pass a single series of `{label, value}` points."],
    doNot: ["Do not pass stacked or multi-series data."],
  },
  props: {},
  demo: AreaChartDemo,
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
    Default: {render: AreaChartDefaultStory},
    Empty: {render: AreaChartEmptyStory},
  },
};
