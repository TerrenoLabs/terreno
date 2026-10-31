import {DemoConfiguration} from "@config";
import {BadgeSelectBadgeComparison, SelectBadgeDemo, SelectBadgeStories} from "@stories/SelectBadge.stories";
import {SelectBadge} from "@terreno/ui";
import React from "react";

export const SelectBadgeConfiguration: DemoConfiguration = {
  usageExample: "import {SelectBadge} from \"@terreno/ui\";\n\n<SelectBadge />",
  name: "SelectBadge",
  related: [],
  description:
    "SelectBadge is an interactive badge that can open a dropdown with selectable options.",
  category: "Component",
  component: SelectBadge,
  status: {
    documentation: "planned",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r/Terreno-Design-System?node-id=4013-23972&t=J847q9JMSjR8oQmN-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  usage: {
    do: [
      "Use to show status and allow selecting one or more options",
      "Use consistent colors for each status type",
      "Use concise option labels",
    ],
    doNot: ["Overload with too many options", "Use for non-interactive status-only indicators"],
  },
  a11yNotes: [
    "Ensure options are accessible via screen readers",
    "Do not rely solely on color to convey meaning",
  ],
  interfaceName: "SelectBadgeProps",
  props: {},
  demo: SelectBadgeDemo,
  demoOptions: {
    size: "md",
    controls: {
      status: {
        type: "select",
        options: [
          {label: "Info", value: "info"},
          {label: "Error", value: "error"},
          {label: "Warning", value: "warning"},
          {label: "Success", value: "success"},
          {label: "Neutral", value: "neutral"},
        ],
        defaultValue: "info",
      },
      secondary: {
        type: "boolean",
        defaultValue: false,
      },
      disabled: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  stories: {
    "Badge vs SelectBadge": {
      render: () => <BadgeSelectBadgeComparison />,
    },
    SelectBadges: {
      description: "",
      render: () => <SelectBadgeStories />,
    },
  },
};
