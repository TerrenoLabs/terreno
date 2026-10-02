import type {DemoConfiguration} from "@config";
import {GPTMemoryModalDemo, GPTMemoryModalEmpty} from "@stories/GPTMemoryModal.stories";
import {GPTMemoryModal} from "@terreno/ui";

export const GPTMemoryModalConfiguration: DemoConfiguration = {
  usageExample: "import {GPTMemoryModal} from \"@terreno/ui\";\n\n<GPTMemoryModal />",
  a11yNotes: ["The modal starts closed so it does not trap the demo page."],
  additionalDocumentation: [],
  category: "Pattern",
  component: GPTMemoryModal,
  demo: () => <GPTMemoryModalDemo />,
  demoOptions: {size: "lg"},
  description: "System-memory editor for GPTChat. Open it from the button; it starts closed.",
  interfaceName: "GPTMemoryModalProps",
  name: "GPTMemoryModal",
  props: {},
  related: ["GPTChat", "Modal"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Empty: {render: () => <GPTMemoryModalEmpty />},
  },
  usage: {
    do: ["Keep visible false until the user opens the editor."],
    doNot: ["Do not mount the modal visible on the demo home page."],
  },
};
