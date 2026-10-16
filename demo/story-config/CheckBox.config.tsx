import {DemoConfiguration} from "@config";
import {CheckboxColors, CheckboxDemo, CheckboxSizes} from "@stories/CheckBox.stories";
import {CheckBox} from "@terreno/ui";

export const CheckBoxConfiguration: DemoConfiguration = {
  usageExample: "import {CheckBox} from \"@terreno/ui\";\n\n<CheckBox />",
  name: "CheckBox",
  component: CheckBox,
  related: ["Multiselect field", "Radio field"],
  description:
    "CheckBox is used for multiple choice selection. They are independent of each other in a list, and therefore, different from RadioButton, one selection does not affect other checkboxes in the same list.",
  shortDescription: "CheckBox is used for multiple choice selection.",
  a11yNotes: [
    "Labels should be readable by screen readers.",
    "Labels should be able to be clicked or tapped to check/uncheck the checkboxes.",
    "Keyboards should be able to tab back and forth between the checkboxes.",
    "The checkboxes should have a focus state.",
  ],
  category: ["Component", "Form"],
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-23974",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [{name: "NN/g article", link: "https://www.nngroup.com/articles/"}],
  interfaceName: "CheckBoxProps",
  usage: {
    do: [
      "Use a checkbox when selection doesn’t take immediate effect and requires form submission.",
      "Keep text concise.",
      "Use a tooltip if needed.",
    ],
    doNot: [
      "Do NOT use checkboxes if the checkbox will have an immediate state change. Use switches instead.",
    ],
  },
  props: {},
  demo: CheckboxDemo,
  demoOptions: {
    controls: {
      selected: {type: "boolean", defaultValue: true},
      size: {
        type: "select",
        options: [
          {label: "Small", value: "sm"},
          {label: "Medium", value: "md"},
          {label: "Large", value: "lg"},
        ],
        defaultValue: "md",
      },
      bgColor: {
        type: "select",
        options: [
          {label: "Default", value: "default"},
          {label: "Accent", value: "accent"},
          {label: "Black", value: "black"},
        ],
        defaultValue: "default",
      },
    },
  },
  stories: {
    Sizes: {render: CheckboxSizes},
    Colors: {render: CheckboxColors},
  },
};
