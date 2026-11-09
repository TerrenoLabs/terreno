import {DemoConfiguration} from "@config";
import {
  ScorecardComparisonStory,
  ScorecardDemo,
  ScorecardStringStory,
} from "@stories/Scorecard.stories";
import {Scorecard} from "@terreno/ui";

export const ScorecardConfiguration: DemoConfiguration = {
  name: "Scorecard",
  component: Scorecard,
  related: ["SparklineChart", "ChartCard", "DashboardGrid"],
  usageExample: `import {Scorecard} from "@terreno/ui";

<Scorecard
  title="Cost"
  value={569}
  formatValue={(value) => \`$\${value}\`}
  sparklineData={[{label: "Mon", value: 92}, {label: "Tue", value: 108}]}
/>`,
  description:
    "Compact KPI tile with a formatted value and optional solid-current/dotted-comparison sparkline.",
  a11yNotes: [
    "The title and formatted value remain text.",
    "A period badge becomes a button only when onPeriodPress is provided.",
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
  interfaceName: "ScorecardProps",
  usage: {
    do: [
      "Use formatValue for numeric currency, percentage, or compact-number copy.",
      "Pair sparklineData with comparisonData for current-vs-previous KPIs.",
    ],
    doNot: [
      "Do not put axes or legends inside a scorecard sparkline.",
      "Do not preformat a numeric value when formatValue can own the display rule.",
    ],
  },
  props: {},
  demo: ScorecardDemo,
  demoOptions: {
    size: "lg",
    controls: {
      title: {
        type: "text",
        defaultValue: "Cost",
      },
      value: {
        type: "number",
        defaultValue: 569,
      },
    },
  },
  stories: {
    Comparison: {render: ScorecardComparisonStory},
    "String value": {render: ScorecardStringStory},
  },
};
