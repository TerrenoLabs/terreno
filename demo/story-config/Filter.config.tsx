import {DemoConfiguration} from "@config";
import {
  FilterDemo,
  FilterNoActionsDemo,
  FilterSubComponentsDemo,
} from "@stories/Filter.stories";
import {Filter} from "@terreno/ui";
import React from "react";

export const FilterConfiguration: DemoConfiguration = {
  name: "Filter",
  component: Filter,
  related: ["Select field", "Boolean field", "Accordion"],
  description:
    "A compositional filter dropdown for data-heavy views. Combine the select menu, boolean, and accordion sub-components inside the parent, with an optional Apply/Clear/Cancel footer. Desktop web only.",
  a11yNotes: [
    "The trigger button opens and closes the dropdown; clicking outside closes it.",
    "Tab key navigation moves through the dropdown content.",
    "Each sub-component's click zone follows the design spec (select menu: the select only; boolean and accordion: the entire row).",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r/Terreno-Design-System?node-id=3458-6098",
    ios: "notSupported",
    android: "notSupported",
    web: "ready",
  },
  interfaceName: "FilterProps",
  usage: {
    do: [
      "Compose the select menu, boolean, and accordion sub-components to build a filter.",
      "Enable the 'Show Changes' badge on a control when its value differs from the default.",
      "Toggle the Apply/Clear/Cancel footer on or off to match the flow.",
    ],
    doNot: [
      "Do not use on mobile native — this pattern is desktop web only.",
      "Do not hardcode colors or spacing; the components use design system tokens.",
    ],
  },
  props: {},
  demo: FilterDemo,
  demoOptions: {},
  stories: {
    Filter: {
      render: () => <FilterDemo />,
    },
    "Without Action Buttons": {
      render: () => <FilterNoActionsDemo />,
    },
    "Sub-components": {
      render: () => <FilterSubComponentsDemo />,
    },
  },
};
