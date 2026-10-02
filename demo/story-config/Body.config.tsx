import type {DemoConfiguration} from "@config";
import {BodyDemo, BodyLoading} from "@stories/Body.stories";
import {Body} from "@terreno/ui";

export const BodyConfiguration: DemoConfiguration = {
  usageExample: "import {Body} from \"@terreno/ui\";\n\n<Body />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: Body,
  demo: () => <BodyDemo />,
  demoOptions: {size: "lg"},
  description: "Page body primitive with optional scroll and loading spinner.",
  interfaceName: "BodyProps",
  name: "Body",
  props: {},
  related: ["Page", "Box"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Loading: {render: () => <BodyLoading />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
