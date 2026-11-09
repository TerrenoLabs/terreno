import type {DemoConfiguration} from "@config";
import {SimpleContentCopy, SimpleContentDemo} from "@stories/SimpleContent.stories";
import {SimpleContent} from "@terreno/ui";

export const SimpleContentConfiguration: DemoConfiguration = {
  usageExample: "import {SimpleContent} from \"@terreno/ui\";\n\n<SimpleContent />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: SimpleContent,
  demo: () => <SimpleContentDemo />,
  demoOptions: {size: "lg"},
  description:
    "Public ModalSheet export wrapping Modalize. Open and dismiss from the default demo.",
  interfaceName: "SimpleContentProps",
  name: "SimpleContent",
  props: {},
  related: ["ActionSheet", "Modal"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Copy: {render: () => <SimpleContentCopy />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
