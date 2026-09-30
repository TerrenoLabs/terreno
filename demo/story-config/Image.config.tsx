import type {DemoConfiguration} from "@config";
import {ImageContain, ImageDemo} from "@stories/Image.stories";
import {Image} from "@terreno/ui";

export const ImageConfiguration: DemoConfiguration = {
  usageExample: "import {Image} from \"@terreno/ui\";\n\n<Image />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: Image,
  demo: () => <ImageDemo />,
  demoOptions: {size: "lg"},
  description: "Remote image with required width via naturalWidth or fullWidth.",
  interfaceName: "ImageProps",
  name: "Image",
  props: {},
  related: ["ImageBackground"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Contain: {render: () => <ImageContain />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
