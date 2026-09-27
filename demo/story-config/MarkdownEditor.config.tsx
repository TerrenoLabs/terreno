import type {DemoConfiguration} from "@config";
import {MarkdownEditorDemo, MarkdownEditorDisabled} from "@stories/MarkdownEditor.stories";
import {MarkdownEditor} from "@terreno/ui";

export const MarkdownEditorConfiguration: DemoConfiguration = {
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: MarkdownEditor,
  demo: () => <MarkdownEditorDemo />,
  demoOptions: {size: "lg"},
  description:
    "Split markdown source and preview. MarkdownEditorField already demos the field wrapper.",
  interfaceName: "MarkdownEditorProps",
  name: "MarkdownEditor",
  props: {},
  related: ["Markdown editor field", "MarkdownView"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Disabled: {render: () => <MarkdownEditorDisabled />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
