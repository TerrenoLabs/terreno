import type {DemoConfiguration} from "@config";
import {ErrorPageDemo, ErrorPageNetwork} from "@stories/ErrorPage.stories";
import {ErrorPage} from "@terreno/ui";

export const ErrorPageConfiguration: DemoConfiguration = {
  usageExample: "import {ErrorPage} from \"@terreno/ui\";\n\n<ErrorPage />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: ErrorPage,
  demo: () => <ErrorPageDemo />,
  demoOptions: {size: "lg"},
  description: "Full-page error recovery UI with Try again.",
  interfaceName: "ErrorPageProps",
  name: "ErrorPage",
  props: {},
  related: ["ErrorBoundary"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Network: {render: () => <ErrorPageNetwork />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
