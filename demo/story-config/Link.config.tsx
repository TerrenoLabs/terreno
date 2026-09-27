import {DemoConfiguration} from "@config";
import {LinkDemo} from "@stories/Link.stories";
import {Text} from "@terreno/ui";

export const LinkConfiguration: DemoConfiguration = {
  name: "Link",
  component: Text, // Replace with actual component reference
  related: ["Text"],
  description: "",
  a11yNotes: [""],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink: "",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TextProps",
  usage: {
    do: [],
    doNot: [],
  },
  props: {},
  demo: LinkDemo,
  demoOptions: {},
  stories: {
    Link: {render: LinkDemo},
  },
};
