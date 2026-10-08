import type {DemoConfiguration} from "@config";
import {BlocksPlaygroundDemo} from "@stories/BlocksPlayground.stories";
import {BlocksView} from "@terreno/ui";

export const BlocksPlaygroundConfiguration: DemoConfiguration = {
  a11yNotes: [
    "The preview uses the same heading, text, and error banner as BlocksView, so a screen reader reads those roles.",
  ],
  additionalDocumentation: [],
  category: "Pattern",
  component: BlocksView,
  demo: () => <BlocksPlaygroundDemo />,
  demoOptions: {size: "lg"},
  description:
    "Paste a whole-reply YAML document and see it render. The Invalid preset shows the error banner. The Sunday roast preset is the golden roast reply with every rich block.",
  interfaceName: "BlocksViewProps",
  name: "BlocksPlayground",
  props: {},
  related: ["BlocksView", "GPTChat", "Text area"],
  stories: {
    Playground: {
      description:
        "Layout, Invalid, and Sunday roast presets. Editing the text area updates the preview.",
      render: () => <BlocksPlaygroundDemo />,
    },
    "Sunday roast": {
      description:
        "The Sunday roast golden document with swatch photos: gallery, summary card, menu list, stepper with a copy button, the lamb table, checklist, and follow-up buttons. Stepper and checklist callbacks are listed in hostActions, but the playground has no host, so presses do nothing.",
      render: () => <BlocksPlaygroundDemo initialPreset="Roast" />,
    },
  },
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  usage: {
    do: [
      "Start from a preset, then edit the YAML to see the preview update.",
      "Use the Invalid preset to see the banner and the collapsed raw document.",
    ],
    doNot: ["Treat the playground as the chat. GPTChat renders documents when uiBlocks is on."],
  },
  usageExample:
    'import {BlocksView} from "@terreno/ui";\n\n<BlocksView document={yaml} />',
};
