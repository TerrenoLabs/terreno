import {DemoConfiguration} from "@config";
import {DefaultDemo} from "@stories/DefaultDemo";
import {DrawerStory} from "@stories/SideDrawer.stories";
import {SideDrawer} from "@terreno/ui";
import React from "react";

export const SideDrawerConfiguration: DemoConfiguration = {
  name: "Side drawer",
  component: SideDrawer,
  related: ["Modal"],
  description:
    "Side drawers function like the Material navigation drawer. They open up a surface that allows the system to display information, navigation, or other content.",
  a11yNotes: [
    "If an element opens a side drawer, users should be able to click space/enter to do so.",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/file/ykXj5qjjtFjOYkAvTasu9r/Flourish-Health-Design-System?type=design&node-id=656%3A24263&mode=design&t=IZ8oGBzUmBzUtZMr-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "SideDrawerProps",
  usage: {
    do: [
      "Use side drawer to display information from a table record row.",
      "Use side drawer to show non-critical information.",
    ],
    doNot: ["Do not use side drawer to show information that’s critical to a task or flow."],
  },
  props: {},
  demo: DefaultDemo,
  demoOptions: {},
  stories: {
    Left: {render: () => <DrawerStory position="left" />},
    Right: {render: () => <DrawerStory position="right" />},
  },
};
