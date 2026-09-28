import {DemoConfiguration} from "@config";
import {DateTimeField} from "@terreno/ui";

import {DateTimeFieldDemo, DateTimeFieldStory, DateTimeFieldTypes} from "../stories/DateTimeField.stories";

// TODO: Update with the notes from TimeField and DateField.
export const DateTimeFieldConfiguration: DemoConfiguration = {
  usageExample: "import {DateTimeField} from \"@terreno/ui\";\n\n<DateTimeField />",
  name: "Date & Time field",
  component: DateTimeField,
  related: ["Modal"],
  description:
    "This form field allows the user to select a date and a time. Used in conjunction with the date & time modal in this pattern.",
  a11yNotes: [
    "Users should be able to use the tab key to navigate between fields.",
    "Users should be able to use the enter/space keys to open up the date/time modal.",
  ],
  category: ["Component", "Form"],
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/file/ykXj5qjjtFjOYkAvTasu9r/Flourish-Health-Design-System?type=design&node-id=656%3A24069&mode=design&t=AKQ8wyFQBA4qC5eF-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "DateTimeFieldProps",
  usage: {
    do: [
      "Use the descriptive text when there’s an error.",
      "Whenever possible, tell a user why a field is disabled.",
    ],
    doNot: ["Do not remove the descriptive text when there’s an error."],
  },
  props: {},
  demo: DateTimeFieldDemo,
  demoOptions: {
    controls: {
      type: {
        type: "select",
        defaultValue: "datetime",
        options: [
          {label: "time", value: "time"},
          {label: "datetime", value: "datetime"},
          {label: "date", value: "date"},
        ],
      },
      disabled: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  stories: {
    DateTimeField: {render: DateTimeFieldStory},
    "Date Time Types": {render: DateTimeFieldTypes},
  },
};
