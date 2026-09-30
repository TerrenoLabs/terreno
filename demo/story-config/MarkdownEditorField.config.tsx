import {DemoConfiguration} from "@config";
import {
  MarkdownEditorFieldDemo,
  MarkdownEditorFieldDisabled,
  MarkdownEditorFieldWithError,
  MarkdownEditorFieldWithHelper,
} from "@stories/MarkdownEditorField.stories";
import {MarkdownEditorField} from "@terreno/ui";

export const MarkdownEditorFieldConfiguration: DemoConfiguration = {
  usageExample: "import {MarkdownEditorField} from \"@terreno/ui\";\n\n<MarkdownEditorField />",
  name: "Markdown editor field",
  component: MarkdownEditorField,
  related: ["MarkdownView", "Text area", "Text field"],
  description:
    "A side-by-side markdown editor with a text input on the left and a live preview on the right. Useful for editing rich text content in admin panels and forms.",
  a11yNotes: ["The text input supports standard keyboard navigation and screen readers."],
  category: "Form",
  status: {
    documentation: "ready",
    figma: "planned",
    figmaLink: "",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TextAreaProps",
  usage: {
    do: [
      "Use for fields that accept markdown-formatted content.",
      "Use in admin panels for content editing.",
      "Provide helper text explaining supported markdown syntax.",
    ],
    doNot: [
      "Do not use for short, single-line text inputs.",
      "Do not use for fields that do not support markdown rendering.",
    ],
  },
  props: {},
  demo: MarkdownEditorFieldDemo,
  demoOptions: {
    size: "lg",
  },
  stories: {
    Default: {description: "Side-by-side editor with preview.", render: () => <MarkdownEditorFieldDemo />},
    WithHelperText: {description: "With helper text.", render: MarkdownEditorFieldWithHelper},
    WithError: {description: "With error state.", render: MarkdownEditorFieldWithError},
    Disabled: {description: "Disabled state.", render: MarkdownEditorFieldDisabled},
  },
};
