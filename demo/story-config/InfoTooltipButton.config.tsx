import type {DemoConfiguration} from "@config";
import {InfoTooltipButtonDemo, InfoTooltipButtonLong} from "@stories/InfoTooltipButton.stories";
import {InfoTooltipButton} from "@terreno/ui";

export const InfoTooltipButtonConfiguration: DemoConfiguration = {
  usageExample: "import {InfoTooltipButton} from \"@terreno/ui\";\n\n<InfoTooltipButton />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: InfoTooltipButton,
  demo: () => <InfoTooltipButtonDemo />,
  demoOptions: {size: "lg"},
  description: "Inline help that shows tooltip copy.",
  interfaceName: "InfoTooltipButtonProps",
  name: "InfoTooltipButton",
  props: {},
  related: ["Tooltip", "InfoModalIcon"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Long: {render: () => <InfoTooltipButtonLong />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
