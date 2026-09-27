import {DemoConfiguration} from "@config";
import {HeadingPreview, Headings, renderHeadingText} from "@stories/Heading.stories";
import {HeadingProps} from "@terreno/ui";

export const HeadingConfiguration: DemoConfiguration = {
  name: "Heading",
  component: Headings, // Replace with actual component reference
  related: ["Text"],
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
  interfaceName: "HeadingProps",
  usage: {
    do: [],
    doNot: [],
  },
  props: {},
  demo: (props: HeadingProps & {text?: string; preview?: boolean}) => {
    if (props.preview) {
      return <HeadingPreview />;
    }
    const {text, preview: _preview, ...rest} = props;
    return renderHeadingText(text ?? "Heading", rest);
  },
  demoOptions: {},
  stories: {
    Headings: {render: Headings},
  },
};
