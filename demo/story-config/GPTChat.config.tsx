import type {DemoConfiguration} from "@config";
import {
  GPTChatBlocks,
  GPTChatDemo,
  GPTChatEmpty,
  GPTChatMascot,
  GPTChatNoHistory,
  GPTChatStreaming,
  GPTChatTranscript,
} from "@stories/GPTChat.stories";
import {GPTChat} from "@terreno/ui";

export const GPTChatConfiguration: DemoConfiguration = {
  usageExample: "import {GPTChat} from \"@terreno/ui\";\n\n<GPTChat />",
  name: "GPTChat",
  component: GPTChat,
  related: ["AI Suggestion Box", "MarkdownView"],
  description:
    "Streaming chat surface for Terreno AI. This demo uses a static message list — it does not call a live backend.",
  a11yNotes: ["Chat history and message list should remain keyboard reachable."],
  category: "Pattern",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "GPTChatProps",
  usage: {
    do: [
      "Pass currentMessages and histories from your AI routes.",
      "Keep submit local or mocked in stories so the demo runs without an API.",
      "Pass mascot only when the app owns a character; omit it for the default empty chat.",
    ],
    doNot: ["Do not require a live model endpoint to render the component."],
  },
  props: {},
  demo: () => <GPTChatDemo />,
  demoOptions: {size: "lg"},
  stories: {
    Transcript: {
      description:
        "User bubbles, plain assistant text, one row per tool, and image actions beside ratings.",
      render: () => <GPTChatTranscript />,
    },
    Blocks: {
      description:
        "Assistant reply rendered as blocks: metrics, card, chart, table, and actions on the page.",
      render: () => <GPTChatBlocks />,
    },
    Empty: {
      description: "No messages, with suggested prompts.",
      render: () => <GPTChatEmpty />,
    },
    Mascot: {
      description: "Empty chat with a consumer-supplied mascot above suggested prompts.",
      render: () => <GPTChatMascot />,
    },
    NoHistory: {
      description: "History sidebar hidden with showHistory={false}, for narrow and phone layouts.",
      render: () => <GPTChatNoHistory />,
    },
    Streaming: {
      description: "Assistant reply in progress.",
      render: () => <GPTChatStreaming />,
    },
  },
};
