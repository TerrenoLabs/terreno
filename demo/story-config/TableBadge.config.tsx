import {DemoConfiguration} from "@config";
import {TableBadgeDemo, TableBadgeStates} from "@stories/TableBadge.stories";
import {Table} from "@terreno/ui";

export const TableBadgeConfiguration: DemoConfiguration = {
  usageExample: "import {Table} from \"@terreno/ui\";\n\n<Table />",
  name: "Table badge",
  component: Table,
  related: ["Table"],
  description: "Use the table badges to create easily scannable tags for a record.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-24005",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TableBadgeProps",
  usage: {
    do: ["Use the preset badge styles."],
    doNot: ["Do not create new badge styles without consulting the head of product."],
  },
  props: {},
  demo: TableBadgeDemo,
  demoOptions: {
    controls: {
      status: {
        type: "select",
        options: [
          {label: "Default", value: "info"},
          {label: "Error", value: "error"},
          {label: "Warning", value: "warning"},
        ],
        defaultValue: "info",
      },
    },
  },
  stories: {
    States: {
      render: TableBadgeStates,
    },
  },
};
