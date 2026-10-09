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
    "Paste a whole-reply YAML document and see it render. Presets cover every block type and action kind: All blocks shows one of each, Block type loads one type, Invalid shows the error banner, and Sunday roast is the golden roast reply. Stepper and checklist callbacks run on the device with the same helpers as the server host actions; other actions show a toast.",
  interfaceName: "BlocksViewProps",
  name: "BlocksPlayground",
  props: {},
  related: ["BlocksView", "GPTChat", "Text area"],
  stories: {
    "All blocks": {
      description:
        "One of each block type with bundled photos: heading, text, metric, badge, divider, context, chart, table, actions (segmented, reply, open, callback, copy), html, callout, image, details, stepper, checklist, gallery, list, columns, and a card with an eyebrow. Reply, open, and callback presses show a toast.",
      render: () => <BlocksPlaygroundDemo initialPreset="All blocks" />,
    },
    Playground: {
      description:
        "Layout, Invalid, Sunday roast, and All blocks presets, plus a Block type picker with one preset per block type. Editing the text area updates the preview.",
      render: () => <BlocksPlaygroundDemo />,
    },
    "Sunday roast": {
      description:
        "The Sunday roast golden document with bundled food photos: gallery, summary card, menu list, stepper with a copy button, the lamb table, checklist, and follow-up buttons. − and + scale the shopping list and ticks update the counter on the device, each with a toast; follow-up buttons show the reply they would send.",
      render: () => <BlocksPlaygroundDemo initialPreset="Sunday roast" />,
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
      "Use Block type to load one block type, or All blocks to see every type together.",
    ],
    doNot: [
      "Treat the playground as the chat. GPTChat renders documents when uiBlocks is on.",
      "Expect reply, open, or other callbacks to reach a server. The playground only shows a toast.",
    ],
  },
  usageExample:
    'import {BlocksView} from "@terreno/ui";\n\n<BlocksView document={yaml} />',
};
