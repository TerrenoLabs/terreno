import type {DemoConfiguration} from "@config";
import {
  AskCardAnswered,
  AskCardConfirm,
  AskCardConfirmAnswered,
  AskCardConfirmDestructive,
  AskCardConfirmReadOnly,
  AskCardDemo,
  AskCardError,
  AskCardForm,
  AskCardFormAnswered,
  AskCardFormError,
  AskCardMarkdown,
  AskCardMarkdownAnswered,
  AskCardMarkdownError,
  AskCardPickMany,
  AskCardRadio,
  AskCardReadOnly,
  AskCardSearchable,
} from "@stories/AskCard.stories";
import {AskCard} from "@terreno/ui";

export const AskCardConfiguration: DemoConfiguration = {
  a11yNotes: [
    "GPTChat moves focus to a pending ask so keyboard and screen reader users land on it.",
    "Every control is a labeled Button, RadioField, SelectField, MultiselectField, TextField, TextArea, DateTimeField, BooleanField, or MarkdownEditorField, so each answer is reachable by keyboard.",
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
  related: [
    "BooleanField",
    "DateTimeField",
    "GPTChat",
    "MarkdownEditorField",
    "MultiselectField",
    "RadioField",
    "SelectField",
    "TextArea",
    "TextField",
  ],
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
    Confirm: {
      description: "confirm: approve first in the primary style, deny last.",
      render: () => <AskCardConfirm />,
    },
    "Confirm answered": {
      description: "Confirmed and declined confirm asks as one-line summaries.",
      render: () => <AskCardConfirmAnswered />,
    },
    "Confirm destructive": {
      description: "confirm with destructive: the approve button uses the destructive style.",
      render: () => <AskCardConfirmDestructive />,
    },
    "Confirm read only": {
      description: "No onSubmit: both confirm buttons are disabled.",
      render: () => <AskCardConfirmReadOnly />,
    },
    Form: {
      description: "form: typed fields filled in and submitted at once.",
      render: () => <AskCardForm />,
    },
    "Form answered": {
      description: "Sent and skipped forms, with a label and value list under the summary.",
      render: () => <AskCardFormAnswered />,
    },
    "Form error": {
      description: "Server errors shown on the fields they name.",
      render: () => <AskCardFormError />,
    },
    Markdown: {
      description: "markdown: edit the agent's draft in a markdown editor and send it back.",
      render: () => <AskCardMarkdown />,
    },
    "Markdown answered": {
      description: "Approved, edited, and skipped drafts, with the sent text under the summary.",
      render: () => <AskCardMarkdownAnswered />,
    },
    "Markdown error": {
      description: "A server error about the draft's length under the editor.",
      render: () => <AskCardMarkdownError />,
    },
    "Pick many": {
      description: "select many with checkboxes, selection bounds, and an Other field.",
      render: () => <AskCardPickMany />,
    },
    "Radio options": {
      description: "Four to eight options, or labels too long for buttons.",
      render: () => <AskCardRadio />,
    },
    "Read only": {
      description: "No onSubmit: buttons are disabled and radio and checkbox options show as plain text.",
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
      "Do not render your own buttons for an ask; the card picks buttons, radio, select, or checkboxes from the options.",
      "Do not take an irreversible action from a confirm until the answer is {confirmed: true}.",
      "Do not drop the answered card from the transcript; its summary records what the user chose.",
    ],
  },
};
