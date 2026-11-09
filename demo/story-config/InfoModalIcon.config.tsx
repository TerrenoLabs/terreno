import type {DemoConfiguration} from "@config";
import {InfoModalIconDemo, InfoModalIconWithSubtitle} from "@stories/InfoModalIcon.stories";
import {InfoModalIcon} from "@terreno/ui";

export const InfoModalIconConfiguration: DemoConfiguration = {
  usageExample: "import {InfoModalIcon} from \"@terreno/ui\";\n\n<InfoModalIcon />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: InfoModalIcon,
  demo: () => <InfoModalIconDemo />,
  demoOptions: {size: "lg"},
  description: "ⓘ control that opens a dismissible help modal.",
  interfaceName: "InfoModalIconProps",
  name: "InfoModalIcon",
  props: {},
  related: ["InfoTooltipButton", "Modal"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    WithSubtitle: {render: () => <InfoModalIconWithSubtitle />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
