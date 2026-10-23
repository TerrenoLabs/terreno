import {DemoConfiguration} from "@config";
import {
  CardDemo,
  CardVariants,
  DisplayCardDemo,
  DisplaySizes,
  LightAndDark,
  Plain,
  WithImage,
} from "@stories/Card.stories";
import {Card} from "@terreno/ui";

export const CardConfiguration: DemoConfiguration = {
  usageExample: "import {Card} from \"@terreno/ui\";\n\n<Card />",
  name: "Card",
  component: Card,
  related: ["Box", "EditableCard"],
  description:
    "A card serves as a surface for information. It helps organize and highlight information while providing visual hierarchy. Card renders the container and display surfaces; see EditableCard for a card that summarizes saved information the user can edit.",
  shortDescription:
    "A card serves as a surface for information. It helps organize and highlight information while providing visual hierarchy.",
  a11yNotes: [
    "If using an image, be sure to provide an appropriate alt tag.",
    "If using a button, be sure to follow all of the relevant accessibility standards found here.",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-24016",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [{name: "NN/g article", link: "https://www.nngroup.com/articles/"}],
  interfaceName: "CardProps",
  usage: {
    do: [
      "Use a display card to highlight a new feature or flow.",
      "Use a container card to pull longform information into a tidy column, especially on larger screens.",
      "Use EditableCard, which wraps Card, to show a short summary of saved information the user can edit.",
    ],
    doNot: ["Do not put information for a task or flow on a card. Consider using a modal instead."],
  },
  props: {},
  demo: CardDemo,
  demoOptions: {},
  stories: {
    Plain: {render: Plain},
    Display: {
      description:
        "Display cards feature a colored header, title, description, and an action button to highlight a feature or guide users into a flow.",
      render: DisplayCardDemo,
    },
    Variants: {
      description: "All card variants side by side.",
      render: CardVariants,
    },
    LightAndDark: {
      description: "Cards adapt to both light and dark themes.",
      render: LightAndDark,
    },
    DisplaySizes: {
      description:
        "Display cards support three sizes. On desktop, large and default lay out horizontally; small is always vertical. On mobile, all sizes use a vertical layout.",
      render: DisplaySizes,
    },
    WithImage: {
      description:
        "Display cards support a header image. Pass imageUri to replace the colored header with a full-width cover photo.",
      render: WithImage,
    },
  },
};
