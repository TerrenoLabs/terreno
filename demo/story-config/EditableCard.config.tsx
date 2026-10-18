import {DemoConfiguration} from "@config";
import {
  EditableCardDemo,
  EditableCardLightAndDark,
  EditableCardStates,
} from "@stories/EditableCard.stories";
import {EditableCard} from "@terreno/ui";

export const EditableCardConfiguration: DemoConfiguration = {
  usageExample: "import {EditableCard} from \"@terreno/ui\";\n\n<EditableCard />",
  name: "EditableCard",
  component: EditableCard,
  related: ["Card", "Badge", "IconButton"],
  description:
    "An editable card summarizes saved information in a compact row and gives the user a way to edit it. It wraps a Card, which provides the card surface, and adds an optional leading icon, a title with an optional badge, a description, helper text, and an edit button.",
  shortDescription:
    "A compact card summarizing saved information the user can edit, with an optional icon, badge, and helper text.",
  a11yNotes: [
    "Set editAccessibilityLabel to describe what is being edited, e.g. \"Edit home address\". It defaults to the generic \"Edit\".",
    "The edit button is only rendered when onEdit is provided, so cards without an edit action expose no interactive element.",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4012-11316",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  interfaceName: "EditableCardProps",
  usage: {
    do: [
      "Use an editable card to show a short summary of saved information the user can edit.",
      "Set attention to highlight a card whose information needs review.",
      "Keep the description to a short summary; move longer content into its own screen or modal.",
    ],
    doNot: [
      "Do not use an editable card as a generic surface for arbitrary content. Use a container Card instead.",
      "Do not put a form or multi-step flow inside an editable card. Open a modal or screen from onEdit.",
    ],
  },
  props: {},
  demo: EditableCardDemo,
  demoOptions: {},
  stories: {
    States: {
      description:
        "Default, attention, and minimal editable cards. The icon, badge, helper text, and edit button are all optional.",
      render: EditableCardStates,
    },
    LightAndDark: {
      description: "Editable cards adapt to both light and dark themes.",
      render: EditableCardLightAndDark,
    },
  },
};
