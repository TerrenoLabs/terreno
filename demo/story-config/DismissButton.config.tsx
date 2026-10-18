import type {DemoConfiguration} from "@config";
import {DismissButtonDemo, DismissButtonSecondary} from "@stories/DismissButton.stories";
import {DismissButton} from "@terreno/ui";

export const DismissButtonConfiguration: DemoConfiguration = {
  usageExample: "import {DismissButton} from \"@terreno/ui\";\n\n<DismissButton />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: DismissButton,
  demo: () => <DismissButtonDemo />,
  demoOptions: {size: "lg"},
  description: "Small X control for banners and chips.",
  interfaceName: "DismissButtonProps",
  name: "DismissButton",
  props: {},
  related: ["Banner", "AttachmentPreview"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Secondary: {render: () => <DismissButtonSecondary />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
