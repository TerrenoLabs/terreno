import {DemoConfiguration} from "@config";
import {HeadingPreview, Headings, renderHeadingText} from "@stories/Heading.stories";
import {HeadingProps} from "@terreno/ui";

export const HeadingConfiguration: DemoConfiguration = {
  usageExample: "import {Headings} from \"@terreno/ui\";\n\n<Headings />",
  name: "Heading",
  component: Headings, // Replace with actual component reference
  related: ["Text"],
  description: "",
  a11yNotes: [
    'Pass level (1-6) to expose the text as a heading: role="heading" with aria-level, an <h1>-<h6> on web and the header role on native. Without level it is plain text.',
    "Use level 1 for the page title and step down one level per nesting; don't pick a level for its size.",
  ],
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
