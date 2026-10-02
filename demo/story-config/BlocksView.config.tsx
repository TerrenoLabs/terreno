import type {DemoConfiguration} from "@config";
import {
  BlocksViewActions,
  BlocksViewDemo,
  BlocksViewDisplay,
  BlocksViewInvalid,
} from "@stories/BlocksView.stories";
import {BlocksView} from "@terreno/ui";

export const BlocksViewConfiguration: DemoConfiguration = {
  a11yNotes: [
    "Headings, badges, and body text use the same components as the rest of the app, so screen readers read them as headings and text.",
  ],
  additionalDocumentation: [],
  category: "Pattern",
  component: BlocksView,
  demo: () => <BlocksViewDemo />,
  demoOptions: {size: "lg"},
  description:
    "Renders a whole-reply YAML document of Terreno components. An invalid document shows an error banner and keeps the raw text collapsed.",
  interfaceName: "BlocksViewProps",
  name: "BlocksView",
  props: {},
  related: ["Badge", "Card", "GPTChat", "Heading", "MarkdownView"],
  stories: {
    Actions: {
      description:
        "Segmented control switches the chart dataset. Reply and open buttons stay in the document.",
      render: () => <BlocksViewActions />,
    },
    Display: {
      description: "A warning callout, a receipt image, and invoice notes in an accordion.",
      render: () => <BlocksViewDisplay />,
    },
    Invalid: {
      description: "An unknown field shows an error banner. The raw document stays collapsed.",
      render: () => <BlocksViewInvalid />,
    },
    Layout: {
      description: "Heading, text, metrics in columns, and a card with a badge, context, and divider.",
      render: () => <BlocksViewDemo />,
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
      "Pass the assistant reply as document. A non-document becomes one text block.",
      "Keep columns to two through four children. They stack on small screens.",
    ],
    doNot: [
      "Render the raw YAML as the message when validation fails. Show the banner and keep the source collapsed.",
    ],
  },
  usageExample: 'import {BlocksView} from "@terreno/ui";\n\n<BlocksView document={reply} />',
};
