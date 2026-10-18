import type {DemoConfiguration} from "@config";
import {ActionSheetClosed, ActionSheetDemo} from "@stories/ActionSheet.stories";
import {ActionSheet} from "@terreno/ui";

export const ActionSheetConfiguration: DemoConfiguration = {
  usageExample: "import {ActionSheet} from \"@terreno/ui\";\n\n<ActionSheet />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: ActionSheet,
  demo: () => <ActionSheetDemo />,
  demoOptions: {size: "lg"},
  description: "Bottom sheet overlay opened from a ref. Open and dismiss from the default demo.",
  interfaceName: "ActionSheetProps",
  name: "ActionSheet",
  props: {},
  related: ["Modal", "SimpleContent"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Closed: {render: () => <ActionSheetClosed />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
