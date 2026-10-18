import {DemoConfiguration} from "@config";
import {TableBooleanDemo, TableBooleanStates} from "@stories/TableBoolean.stories";
import {TableBoolean} from "@terreno/ui";

export const TableBooleanConfiguration: DemoConfiguration = {
  usageExample: "import {TableBoolean} from \"@terreno/ui\";\n\n<TableBoolean />",
  name: "Table boolean",
  component: TableBoolean,
  related: ["Table"],
  description: "Use the table boolean to create easily scannable binary information for a user.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-24004",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TableBooleanProps",
  usage: {
    do: ["Use this field to represent a binary. Has/has not, for example."],
    doNot: ["Do not use this to represent data that’s not a true binary."],
  },
  props: {},
  demo: TableBooleanDemo,
  demoOptions: {
    controls: {
      value: {
        type: "boolean",
        defaultValue: true,
      },
      isEditing: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  stories: {
    States: {
      render: TableBooleanStates,
    },
  },
};
