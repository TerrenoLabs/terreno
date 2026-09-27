import {DemoConfiguration} from "@config";
import {
  HeightFieldDemo,
  HeightFieldDisabledDemo,
  HeightFieldWithErrorDemo,
  HeightFieldWithHelperTextDemo,
  HeightFieldWithValueDemo,
} from "@stories/HeightField.stories";
import {HeightField} from "@terreno/ui";

export const HeightFieldConfiguration: DemoConfiguration = {
  usageExample: "import {HeightField} from \"@terreno/ui\";\n\n<HeightField />",
  name: "Height field",
  component: HeightField,
  related: ["Number field", "Text field"],
  description:
    "Use the Height field to allow users to input their height. The field stores the value as total inches and displays it as feet and inches. On web, two text inputs accept feet and inches separately. On iOS, tapping the field opens an action sheet for selection. On Android, two dropdowns allow selection of feet and inches. Supports optional min/max props to constrain the allowed height range.",
  a11yNotes: [
    "Users should be able to use tab to navigate between the feet and inches inputs.",
    "The field should announce the current value to screen readers.",
    "On mobile, the action sheet should be accessible via screen readers.",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "HeightFieldProps",
  usage: {
    do: [
      "Use this component for height input in forms.",
      "Display the value in a human-readable format (e.g., 5ft 10in).",
      "Provide clear error messages when validation fails.",
    ],
    doNot: [
      "Do not use this component for other measurements like weight or distance.",
      "Do not allow values outside the valid range. Use min/max props to constrain if needed.",
    ],
  },
  props: {},
  demo: HeightFieldDemo,
  demoOptions: {},
  stories: {
    "Basic Height Field": {
      render: HeightFieldDemo,
    },
    "Height Field with Value": {
      render: HeightFieldWithValueDemo,
    },
    "Height Field with Helper Text": {
      render: HeightFieldWithHelperTextDemo,
    },
    "Height Field with Error": {
      render: HeightFieldWithErrorDemo,
    },
    "Disabled Height Field": {
      render: HeightFieldDisabledDemo,
    },
  },
};
