import type {DemoConfiguration} from "@config";
import {ImageBackgroundDemo, ImageBackgroundPlain} from "@stories/ImageBackground.stories";
import {ImageBackground} from "@terreno/ui";

export const ImageBackgroundConfiguration: DemoConfiguration = {
  usageExample: "import {ImageBackground} from \"@terreno/ui\";\n\n<ImageBackground />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: ImageBackground,
  demo: () => <ImageBackgroundDemo />,
  demoOptions: {size: "lg"},
  description: "React Native ImageBackground wrapper for overlaying UI on a photo.",
  interfaceName: "ImageBackgroundProps",
  name: "ImageBackground",
  props: {},
  related: ["Image"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Caption: {render: () => <ImageBackgroundPlain />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
