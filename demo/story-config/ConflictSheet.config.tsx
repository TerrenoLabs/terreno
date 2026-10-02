import type {DemoConfiguration} from "@config";
import {ConflictSheetDemo, ConflictSheetEmpty} from "@stories/ConflictSheet.stories";
import {ConflictSheet} from "@terreno/ui";

export const ConflictSheetConfiguration: DemoConfiguration = {
  usageExample: "import {ConflictSheet} from \"@terreno/ui\";\n\n<ConflictSheet />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: ConflictSheet,
  demo: () => <ConflictSheetDemo />,
  demoOptions: {size: "lg"},
  description: "Modal for choosing local vs server versions of a sync conflict.",
  interfaceName: "ConflictSheetProps",
  name: "ConflictSheet",
  props: {},
  related: ["SyncStatusBanner", "Modal"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Empty: {render: () => <ConflictSheetEmpty />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
