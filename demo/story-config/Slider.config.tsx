import {DemoConfiguration} from "@config";
import {
  SliderBoxShadowDemo,
  SliderDemo,
  SliderWithIconsDemo,
  SliderWithInlineLabelsDemo,
  SliderWithLabelsDemo,
  SliderWithSmileysDemo,
  SliderWithValueDemo,
} from "@stories/Slider.stories";
import {Slider} from "@terreno/ui";

export const SliderConfiguration: DemoConfiguration = {
  usageExample: "import {Slider} from \"@terreno/ui\";\n\n<Slider />",
  name: "Slider",
  component: Slider,
  related: ["Number field"],
  description:
    "Use the slider component to allow users to select a numeric value from a range by dragging a thumb along a track.",
  a11yNotes: [
    "Touch zone is very important here, and must be at least 48 by 48 px. The “handle” as its currently designed fulfills this.",
    "Contrast is also important. It should be obvious when the active track is present, and when it’s not.",
  ],
  category: ["Component", "Form"],
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink: "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-23983",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "SliderProps",
  usage: {
    do: [
      "Provide contextual labels. The Mood and Numeric variants have these built in, but the basic one would need something descriptive, such as a title.",
      "Provide visual feedback. For the numeric slider, this is automatically satisfied by the numbers changing on the handle. For the mood slider, this would be satisfied by the feedback slider pattern.",
      "Use sufficient touch targets for the handle. Resist the urge to make it smaller!",
    ],
    doNot: [
      "When adding additional visual feedback, don’t rely solely on color. Use additional cues like shapes, labels, or patterns to convey information for colorblind users.",
      "Don’t overcrowd the interface with sliders.",
      "Don’t use sliders for binary choices.",
    ],
  },
  props: {},
  demo: SliderDemo,
  demoOptions: {},
  stories: {
    "Basic Slider": {
      render: SliderDemo,
    },
    "Slider with Box Shadow": {
      description: "Demonstrates the box shadow styling on the slider thumb",
      render: SliderBoxShadowDemo,
    },
    "Slider with Emojis": {
      render: SliderWithSmileysDemo,
    },
    "Slider with Value": {
      render: SliderWithValueDemo,
    },
    "Slider with Icons": {
      render: SliderWithIconsDemo,
    },
    "Slider with Labels": {
      render: SliderWithLabelsDemo,
    },
    "Slider with Inline Labels": {
      render: SliderWithInlineLabelsDemo,
    },
  },
};
