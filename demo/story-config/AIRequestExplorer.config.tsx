import type {DemoConfiguration} from "@config";
import {AIRequestExplorerDemo, AIRequestExplorerLoading} from "@stories/AIRequestExplorer.stories";
import {AIRequestExplorer} from "@terreno/ui";

export const AIRequestExplorerConfiguration: DemoConfiguration = {
  usageExample: "import {AIRequestExplorer} from \"@terreno/ui\";\n\n<AIRequestExplorer />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: AIRequestExplorer,
  demo: () => <AIRequestExplorerDemo />,
  demoOptions: {size: "lg"},
  description: "Admin table of AI requests with paging and filters.",
  interfaceName: "AIRequestExplorerProps",
  name: "AIRequestExplorer",
  props: {},
  related: ["DataTable", "GPTChat"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Loading: {render: () => <AIRequestExplorerLoading />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
