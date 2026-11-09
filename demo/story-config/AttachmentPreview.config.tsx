import type {DemoConfiguration} from "@config";
import {AttachmentPreviewDemo, AttachmentPreviewEmpty} from "@stories/AttachmentPreview.stories";
import {AttachmentPreview} from "@terreno/ui";

export const AttachmentPreviewConfiguration: DemoConfiguration = {
  usageExample: "import {AttachmentPreview} from \"@terreno/ui\";\n\n<AttachmentPreview />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: AttachmentPreview,
  demo: () => <AttachmentPreviewDemo />,
  demoOptions: {size: "lg"},
  description: "Thumbnails for attached files with remove.",
  interfaceName: "AttachmentPreviewProps",
  name: "AttachmentPreview",
  props: {},
  related: ["FilePickerButton", "DismissButton"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Empty: {render: () => <AttachmentPreviewEmpty />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
