import type {DemoConfiguration} from "@config";
import {
  NumberPickerActionSheetClosed,
  NumberPickerActionSheetDemo,
} from "@stories/NumberPickerActionSheet.stories";
import {NumberPickerActionSheet} from "@terreno/ui";

export const NumberPickerActionSheetConfiguration: DemoConfiguration = {
  usageExample: "import {NumberPickerActionSheet} from \"@terreno/ui\";\n\n<NumberPickerActionSheet />",
  a11yNotes: ["Open from the button; the sheet starts closed."],
  additionalDocumentation: [],
  category: ["Component", "Form"],
  component: NumberPickerActionSheet,
  demo: () => <NumberPickerActionSheetDemo />,
  demoOptions: {size: "lg"},
  description: "Native number wheel inside an ActionSheet. Open and dismiss from the default demo.",
  interfaceName: "NumberPickerActionSheetProps",
  name: "NumberPickerActionSheet",
  props: {},
  related: ["ActionSheet", "Number field"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Closed: {render: () => <NumberPickerActionSheetClosed />},
  },
  usage: {
    do: ["Pass min, max, value, and a ref to show the sheet."],
    doNot: ["Do not leave the sheet visible on first paint of the demo page."],
  },
};
