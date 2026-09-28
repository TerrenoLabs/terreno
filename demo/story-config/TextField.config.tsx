import {DemoConfiguration} from "@config";
import {
  TextFieldDemo,
  TextFieldDisabledDemo,
  TextFieldPasswordDemo,
  TextFieldPasswordNoToggleDemo,
  TextFieldWithErrorMsgDemo,
  TextFieldWithHelperTextDemo,
  TextFieldWithLabelDemo,
} from "@stories/TextField.stories";
import {TextField} from "@terreno/ui";

export const TextFieldConfiguration: DemoConfiguration = {
  usageExample: "import {TextField} from \"@terreno/ui\";\n\n<TextField />",
  name: "Text field",
  component: TextField, // Replace with actual component reference
  related: ["Text area"],
  description: "Use the text field to allow a user to input a single line of text.",
  a11yNotes: ["The user should be able to use tab to navigate between elements."],
  category: ["Component", "Form"],
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/file/ykXj5qjjtFjOYkAvTasu9r/Flourish-Health-Design-System?type=design&node-id=656%3A23515&mode=design&t=IZ8oGBzUmBzUtZMr-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TextFieldProps",
  usage: {
    do: [
      "Use this component for shorter strings. For example, a name.",
      "If an error is returned, tell the user why.",
      "If the field is disabled, tell the user why.",
      'Use type="password" for secrets. It masks the value and adds a show/hide control.',
    ],
    doNot: [
      "Do not use this component if a larger string is allowed or expected. Instead, use Text area.",
    ],
  },
  props: {},
  demo: TextFieldWithHelperTextDemo,
  demoOptions: {},
  stories: {
    "Basic Text Field": {
      render: TextFieldDemo,
    },
    "Text Field with Label": {
      render: TextFieldWithLabelDemo,
    },
    "Text Field with Helper Text": {
      render: TextFieldWithHelperTextDemo,
    },
    "Text Field with Error Message": {
      render: TextFieldWithErrorMsgDemo,
    },
    "Password Text Field": {
      render: TextFieldPasswordDemo,
    },
    "Password Text Field without Show/Hide": {
      render: TextFieldPasswordNoToggleDemo,
    },
    "Disabled Text Field": {
      render: TextFieldDisabledDemo,
    },
  },
};
