import type {DemoConfiguration} from "@config";
import {HtmlFrameDemo} from "@stories/HtmlFrame.stories";
import {HtmlFrame} from "@terreno/ui";

export const HtmlFrameConfiguration: DemoConfiguration = {
  a11yNotes: [
    "The frame is labeled Agent-generated preview. The iframe title is the block title.",
  ],
  additionalDocumentation: [],
  category: "Pattern",
  component: HtmlFrame,
  demo: () => <HtmlFrameDemo />,
  demoOptions: {size: "md"},
  description:
    "Sandboxed preview of agent HTML. Web uses an empty iframe sandbox. Native turns JavaScript off.",
  interfaceName: "HtmlFrameProps",
  name: "HtmlFrame",
  props: {},
  related: ["BlocksView", "Card", "GPTChat"],
  stories: {
    Invoice: {
      description: "A short invoice preview at the small height.",
      render: () => <HtmlFrameDemo />,
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
    do: ["Render HTML only after the server has sanitized it and the reply has finished."],
    doNot: ["Put agent HTML directly in the host page."],
  },
  usageExample:
    'import {HtmlFrame} from "@terreno/ui";\n\n<HtmlFrame height="md" html="<h1>Invoice</h1>" title="Invoice preview" />',
};
