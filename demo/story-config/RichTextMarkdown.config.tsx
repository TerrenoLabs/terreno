import {DemoConfiguration} from "@config";
import {RichTextMarkdownDemo} from "@stories/RichTextMarkdown.stories";
import {EnrichedTextInput} from "react-native-enriched-html";

export const RichTextMarkdownConfiguration: DemoConfiguration = {
  name: "Rich text",
  component: EnrichedTextInput,
  related: ["Markdown editor field", "MarkdownView"],
  description:
    "Proof of concept for a WYSIWYG editor. The same field runs on web, iOS, and Android. Notes are stored as HTML and rendered with EnrichedText.",
  shortDescription: "WYSIWYG HTML editor for web and native.",
  a11yNotes: [
    "Toolbar buttons expose bold, italic, heading, lists, and link as accessibility labels.",
  ],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "planned",
    figmaLink: "",
    ios: "inProgress",
    android: "inProgress",
    web: "inProgress",
  },
  additionalDocumentation: [
    {
      name: "React Native Enriched HTML",
      link: "https://docs.swmansion.com/react-native-enriched-html/",
    },
  ],
  interfaceName: "RichTextMarkdownProps",
  usage: {
    do: [
      "Store the editor output as an HTML string.",
      "Render that string with EnrichedText anywhere the note is read.",
    ],
    doNot: [
      "Do not treat this demo as the shipped editor. Native builds need a dev client, not Expo Go.",
    ],
  },
  props: {},
  demo: (props) => <RichTextMarkdownDemo {...props} />,
  demoOptions: {size: "lg"},
  stories: {},
};
