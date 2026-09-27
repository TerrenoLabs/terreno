import type {DemoConfiguration} from "@config";
import {
  DecimalRangeActionSheetClosed,
  DecimalRangeActionSheetDemo,
} from "@stories/DecimalRangeActionSheet.stories";
import {DecimalRangeActionSheet} from "@terreno/ui";

export const DecimalRangeActionSheetConfiguration: DemoConfiguration = {
  usageExample: "import {DecimalRangeActionSheet} from \"@terreno/ui\";\n\n<DecimalRangeActionSheet />",
  a11yNotes: ["Open from the button; the sheet starts closed."],
  additionalDocumentation: [],
  category: "Component",
  component: DecimalRangeActionSheet,
  demo: () => <DecimalRangeActionSheetDemo />,
  demoOptions: {size: "lg"},
  description: "Whole-plus-tenth picker inside an ActionSheet.",
  interfaceName: "DecimalRangeActionSheetProps",
  name: "DecimalRangeActionSheet",
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
    Closed: {render: () => <DecimalRangeActionSheetClosed />},
  },
  usage: {
    do: ["Pass min, max, value, and a ref to show the sheet."],
    doNot: ["Do not leave the sheet visible on first paint of the demo page."],
  },
};
