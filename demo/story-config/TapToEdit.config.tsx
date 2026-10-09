import {DemoConfiguration} from "@config";
import {TapDemo, TapStory} from "@stories/TapToEdit.stories";
import {TapToEdit} from "@terreno/ui";

export const TapToEditConfiguration: DemoConfiguration = {
  usageExample: "import {TapToEdit} from \"@terreno/ui\";\n\n<TapToEdit />",
  name: "Tap to edit",
  component: TapToEdit,
  related: ["AddressField", "Text field"],
  description:
    "This element allows the user to see information and interact with an icon to edit it. See the pattern here.",
  a11yNotes: [
    "The user should be able to tab to the tap-to-edit icon and press enter/space to interact with it.",
    "The user should be able to tap the label as well to interact with the element.",
  ],
  category: ["Component", "Form"],
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-23984",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TapToEditProps",
  usage: {
    do: [
      "Display the information that will be edited.",
      "If needed, update the font color to font-link.",
    ],
    doNot: ["Do not replace the icon."],
  },
  props: {},
  demo: TapDemo,
  demoOptions: {},
  stories: {
    "Tap to edit": {render: TapStory},
  },
};
