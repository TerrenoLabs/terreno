import {DemoConfiguration} from "@config";
import {PhoneNumberFieldDemo} from "@stories/PhoneNumberField.stories";
import {EmailField} from "@terreno/ui";

export const PhoneNumberConfiguration: DemoConfiguration = {
  usageExample: "import {EmailField} from \"@terreno/ui\";\n\n<EmailField />",
  name: "Phone number field",
  component: EmailField,
  related: ["Text area"],
  description: "Use the phone number field to allow a user to input a valid phone number.",
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
  interfaceName: "PhoneNumberFieldProps",
  usage: {
    do: [],
    doNot: [],
  },
  props: {},
  demo: PhoneNumberFieldDemo,
  demoOptions: {},
  stories: {
    "Phone Number Field": {
      render: () => <PhoneNumberFieldDemo />,
    },
  },
};
