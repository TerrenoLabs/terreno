import type {DemoConfiguration} from "@config";
import {ErrorBoundaryCaught, ErrorBoundaryDemo} from "@stories/ErrorBoundary.stories";
import {ErrorBoundary} from "@terreno/ui";

export const ErrorBoundaryConfiguration: DemoConfiguration = {
  usageExample: "import {ErrorBoundary} from \"@terreno/ui\";\n\n<ErrorBoundary />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: ErrorBoundary,
  demo: () => <ErrorBoundaryDemo />,
  demoOptions: {size: "lg"},
  description: "Catches render errors and shows ErrorPage. Crash the child in the Caught story.",
  interfaceName: "ErrorBoundaryProps",
  name: "ErrorBoundary",
  props: {},
  related: ["ErrorPage"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Caught: {render: () => <ErrorBoundaryCaught />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
