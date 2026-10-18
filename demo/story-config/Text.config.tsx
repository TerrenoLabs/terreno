import {DemoConfiguration} from "@config";
import {renderText, TextLinks, TextPreview, Texts, Truncate} from "@stories/Text.stories";
import {Text, TextProps} from "@terreno/ui";

export const TextConfiguration: DemoConfiguration = {
  usageExample: "import {Text} from \"@terreno/ui\";\n\n<Text />",
  name: "Text",
  component: Text, // Replace with actual component reference
  related: ["Heading"],
  description: "",
  a11yNotes: [""],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "inProgress",
    figmaLink: "",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TextProps",
  usage: {
    do: [],
    doNot: [],
  },
  props: {},
  demo: (props: TextProps & {text?: string; preview?: boolean}) => {
    if (props.preview) {
      return <TextPreview />;
    }
    const {text, preview: _preview, ...rest} = props;
    return renderText(text ?? "default", rest);
  },
  demoOptions: {},
  stories: {
    Texts: {render: Texts},
    Truncate: {render: Truncate},
    TextLinks: {render: TextLinks},
  },
};
