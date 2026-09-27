import type {DemoConfiguration} from "@config";
import {
  AskCardAnswered,
  AskCardDemo,
  AskCardError,
  AskCardRadio,
  AskCardReadOnly,
  AskCardSearchable,
} from "@stories/AskCard.stories";
import {AskCard} from "@terreno/ui";

export const AskCardConfiguration: DemoConfiguration = {
  a11yNotes: [
    "GPTChat moves focus to a pending ask so keyboard and screen reader users land on it.",
    "Every control is a labeled Button, RadioField, or SelectField, so each answer is reachable by keyboard.",
  ],
  additionalDocumentation: [],
  category: "Pattern",
  component: AskCard,
  demo: () => <AskCardDemo />,
  demoOptions: {size: "lg"},
  description:
    "A question an AI agent asks in the chat transcript. Pending asks show controls; answered asks collapse to a one-line summary. GPTChat renders it for messages with `ask`.",
  interfaceName: "AskCardProps",
  name: "AskCard",
  props: {},
  related: ["GPTChat", "RadioField", "SelectField"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Answered: {
      description: "Answered, skipped, and cancelled asks as one-line summaries.",
      render: () => <AskCardAnswered />,
    },
    "Radio options": {
      description: "Four to eight options, or labels too long for buttons.",
      render: () => <AskCardRadio />,
    },
    "Read only": {
      description: "No onSubmit: buttons are disabled and radio options show as plain text.",
      render: () => <AskCardReadOnly />,
    },
    "Searchable options": {
      description: "More than eight options.",
      render: () => <AskCardSearchable />,
    },
    "Server error": {
      description: "Inline errors from a rejected answer.",
      render: () => <AskCardError />,
    },
  },
  usage: {
    do: [
      "Let GPTChat render asks: set `ask` on the tool-call message and pass `onAskSubmit`.",
      "Show server validation errors with `errors` (GPTChat: `askErrors`) so the user can fix the answer.",
    ],
    doNot: [
      "Do not render your own buttons for an ask; the card picks buttons, radio, or select from the options.",
      "Do not drop the answered card from the transcript; its summary records what the user chose.",
    ],
  },
};
