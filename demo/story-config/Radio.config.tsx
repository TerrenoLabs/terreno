import type {DemoConfiguration} from "@config";
import {RadioDemo, RadioSelected} from "@stories/Radio.stories";
import {Radio} from "@terreno/ui";

export const RadioConfiguration: DemoConfiguration = {
  a11yNotes: ["Selected and unselected states should remain distinguishable without color alone."],
  additionalDocumentation: [],
  category: "Component",
  component: Radio,
  demo: () => <RadioDemo />,
  demoOptions: {size: "md"},
  description: "Unlabeled radio glyph used inside RadioField.",
  interfaceName: "RadioProps",
  name: "Radio",
  props: {},
  related: ["Radio field"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Selected: {render: () => <RadioSelected />},
  },
  usage: {
    do: ["Prefer RadioField when the control needs a label and group semantics."],
    doNot: ["Do not use the glyph alone when RadioField already covers the product pattern."],
  },
};
