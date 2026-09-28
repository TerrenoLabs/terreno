import type {DemoConfiguration} from "@config";
import {FilePickerButtonDemo, FilePickerButtonDisabled} from "@stories/FilePickerButton.stories";
import {FilePickerButton} from "@terreno/ui";

export const FilePickerButtonConfiguration: DemoConfiguration = {
  usageExample: "import {FilePickerButton} from \"@terreno/ui\";\n\n<FilePickerButton />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: ["Component", "Form"],
  component: FilePickerButton,
  demo: () => <FilePickerButtonDemo />,
  demoOptions: {size: "lg"},
  description: "Paperclip control that opens an attach modal for images or documents.",
  interfaceName: "FilePickerButtonProps",
  name: "FilePickerButton",
  props: {},
  related: ["AttachmentPreview", "Modal"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Disabled: {render: () => <FilePickerButtonDisabled />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
