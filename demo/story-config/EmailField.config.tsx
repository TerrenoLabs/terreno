import {DemoConfiguration} from "@config";
import {EmailFieldDemo} from "@stories/EmailField.stories";
import {EmailField} from "@terreno/ui";

export const EmailFieldConfiguration: DemoConfiguration = {
  usageExample: "import {EmailField} from \"@terreno/ui\";\n\n<EmailField />",
  name: "Email field",
  component: EmailField,
  related: ["Text area"],
  description: "Use the email field to allow a user to input a valid email.",
  a11yNotes: [],
  category: ["Component", "Form"],
  status: {
    documentation: "planned",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "EmailFieldProps",
  usage: {
    do: [],
    doNot: [],
  },
  props: {},
  demo: EmailFieldDemo,
  demoOptions: {},
  stories: {
    "Email Field": {
      render: () => <EmailFieldDemo />,
    },
  },
};
