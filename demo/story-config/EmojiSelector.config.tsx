import {DemoConfiguration} from "@config";
import {EmojiSelector} from "@terreno/ui";

import {EmojiSelectorDemo} from "../stories/EmojiSelector.stories";

export const EmojiSelectorConfiguration: DemoConfiguration = {
  usageExample: "import {EmojiSelector} from \"@terreno/ui\";\n\n<EmojiSelector />",
  name: "Emoji selector",
  component: EmojiSelector,
  related: ["Text field"],
  description: "A grid-based emoji picker with categories, search, and recent history.",
  a11yNotes: [
    "Ensure emoji choices are keyboard and screen-reader accessible.",
    "Provide clear focus states when navigating between emoji and category tabs.",
  ],
  category: ["Component", "Form"],
  status: {
    documentation: "inProgress",
    figma: "planned",
    ios: "inProgress",
    android: "inProgress",
    web: "inProgress",
  },
  additionalDocumentation: [],
  interfaceName: "EmojiSelectorProps",
  usage: {
    do: [
      "Use in contexts where users need to choose an emoji, such as reactions or messages.",
      "Pair with clear labels or helper text explaining what the emoji selection controls.",
    ],
    doNot: [
      "Do not rely on emoji alone to convey critical information.",
      "Avoid overwhelming users with too many custom categories.",
    ],
  },
  props: {},
  demo: EmojiSelectorDemo,
  demoOptions: {
    controls: {},
  },
  stories: {
    "Emoji Selector": {render: EmojiSelectorDemo},
  },
};
