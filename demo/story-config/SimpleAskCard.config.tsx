import type {DemoConfiguration} from "@config";
import {SimpleAskCardDemo, SimpleAskCardFixtures} from "@stories/SimpleAskCard.stories";
import {SimpleAskCard} from "@terreno/ui";

export const SimpleAskCardConfiguration: DemoConfiguration = {
  a11yNotes: [
    "Every answer is a labeled full-width Button, so each one is a large tap target and reachable by keyboard.",
    "The continue-on-phone line is plain text read after the question, before the buttons.",
  ],
  additionalDocumentation: [],
  category: "Pattern",
  component: SimpleAskCard,
  demo: () => <SimpleAskCardDemo />,
  demoOptions: {size: "lg"},
  description:
    "Any agent ask as a small-screen card: its title, its question, and up to three buttons that each send an exact answer. For watch-sized and other narrow layouts; native watch apps render the same `simple` JSON themselves.",
  interfaceName: "SimpleAskCardProps",
  name: "SimpleAskCard",
  usageExample:
    'import {SimpleAskCard} from "@terreno/ui";\n\n<SimpleAskCard card={pendingAsk.simple} onPress={handleButtonPress} />',
  props: {},
  related: ["AskCard", "GPTChat", "Button"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    "Every fixture": {
      description: "The card of every valid ask fixture in @terreno/blocks, in a 198×242 pt frame.",
      render: () => <SimpleAskCardFixtures />,
    },
  },
  usage: {
    do: [
      "Pass the ask's `simple` card and send the pressed button's id as `{toolCallId, buttonId}` to the history's `turn` action.",
      "Set `pendingButtonId` while the answer is sending so a second tap cannot send another answer.",
    ],
    doNot: [
      "Do not build the buttons yourself; the server derived them once, and each carries the exact answer it sends.",
      "Do not use it for the full chat; AskCard shows every option and the radio or select controls.",
    ],
  },
};
