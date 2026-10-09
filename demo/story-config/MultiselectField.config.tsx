import {DemoConfiguration} from "@config";
import {MultiselectFieldDemo, MultiselectVariants} from "@stories/MultiselectField.stories";
import {MultiselectField} from "@terreno/ui";

export const MultiselectFieldConfiguration: DemoConfiguration = {
  usageExample: "import {MultiselectField} from \"@terreno/ui\";\n\n<MultiselectField />",
  name: "Multiselect Field",
  component: MultiselectField,
  related: ["CheckBox"],
  description:
    "Also called 'checkbox field'. This component is a list of checkable items. In this case, a user can choose one, many, all, or no options.",
  a11yNotes: [
    "Screen readers should know when a set of checkboxes is related.",
    "When a user clicks the checkbox label, they should be able to interact with the checkbox. Learn more about that here.",
  ],
  category: ["Component", "Form"],
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-23992",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [{name: "NN/g article", link: "https://www.nngroup.com/articles/"}],
  interfaceName: "MultiselectFieldProps",
  usage: {
    do: [
      "When inputs within a broader form are closely related and would benefit from a shared legend.",
      "When the user can choose one, many, or no options.",
    ],
    doNot: ["When the fields are unrelated."],
  },
  props: {},
  demo: MultiselectFieldDemo,
  demoOptions: {
    controls: {
      variant: {
        type: "select",
        defaultValue: "leftText",
        options: [
          {label: "Left Text", value: "leftText"},
          {label: "Right Text", value: "rightText"},
        ],
      },
    },
  },
  stories: {
    Variants: {
      render: () => MultiselectVariants(),
    },
  },
};
