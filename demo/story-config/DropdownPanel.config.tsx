import {DemoConfiguration} from "@config";
import {
  DropdownPanelDemo,
  DropdownPanelNoActionsDemo,
  DropdownPanelSubComponentsDemo,
} from "@stories/DropdownPanel.stories";
import {DropdownPanel} from "@terreno/ui";
import React from "react";

export const DropdownPanelConfiguration: DemoConfiguration = {
  name: "DropdownPanel",
  component: DropdownPanel,
  related: ["SelectField", "BooleanField", "Accordion"],
  description:
    "A compositional dropdown panel: a trigger that opens an anchored panel of composed content with an optional Apply/Clear/Cancel footer. Built for filters (combine the select menu, boolean, and accordion sub-components) but usable for any panel content. The panel escapes ancestor clipping, right-aligns rather than running off screen, and flips above the trigger when there is no room below.",
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
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  interfaceName: "DropdownPanelProps",
  usage: {
    do: [
      "Compose the select menu, boolean, and accordion sub-components to build a filter.",
      "Enable the 'Show Changes' badge on a control when its value differs from the default.",
      "Toggle the Apply/Clear/Cancel footer on or off to match the flow.",
    ],
    doNot: [
      "Do not nest a dropdown panel inside another dropdown panel.",
      "Do not hardcode colors or spacing; the components use design system tokens.",
    ],
  },
  props: {},
  demo: DropdownPanelDemo,
  demoOptions: {},
  stories: {
    DropdownPanel: {
      render: () => <DropdownPanelDemo />,
    },
    "Without Action Buttons": {
      render: () => <DropdownPanelNoActionsDemo />,
    },
    "Sub-components": {
      render: () => <DropdownPanelSubComponentsDemo />,
    },
  },
};
