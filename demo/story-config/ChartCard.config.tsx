import {DemoConfiguration} from "@config";
import {
  ChartCardDefaultStory,
  ChartCardDemo,
  ChartCardFilterStory,
} from "@stories/ChartCard.stories";
import {ChartCard} from "@terreno/ui";

export const ChartCardConfiguration: DemoConfiguration = {
  name: "ChartCard",
  component: ChartCard,
  related: ["Scorecard", "DashboardGrid", "BarChart"],
  usageExample: `import {ChartCard, Text} from "@terreno/ui";

<ChartCard title="Conversions by day" periodLabel="Last 14 days">
  <Text>Chart or table content</Text>
</ChartCard>`,
  description:
    "Card chrome for a chart or table: title, optional filter summary, and optional period badge action.",
  a11yNotes: [
    "The period badge has button semantics only when onPeriodPress is provided.",
    "Long titles wrap inside the available header width without pushing out the badge.",
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
  interfaceName: "ChartCardProps",
  usage: {
    do: [
      "Use ChartCard when a chart or table needs shared title and period chrome.",
      "Pass onPeriodPress only when the period badge changes or opens a filter.",
    ],
    doNot: [
      "Do not wrap Scorecard in another ChartCard.",
      "Do not pass onPeriodPress to display-only date copy.",
    ],
  },
  props: {},
  demo: ChartCardDemo,
  demoOptions: {
    size: "lg",
    controls: {
      title: {
        type: "text",
        defaultValue: "Conversions by day",
      },
      periodLabel: {
        type: "text",
        defaultValue: "Last 14 days",
      },
    },
  },
  stories: {
    Default: {render: ChartCardDefaultStory},
    "Filter summary": {render: ChartCardFilterStory},
  },
};
