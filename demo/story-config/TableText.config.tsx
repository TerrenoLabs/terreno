import {DemoConfiguration} from "@config";
import {TableTextDemo, TableTextVariants} from "@stories/TableText.stories";
import {TableText} from "@terreno/ui";

export const TableTextConfiguration: DemoConfiguration = {
  usageExample: "import {TableText} from \"@terreno/ui\";\n\n<TableText />",
  name: "Table Text",
  component: TableText,
  related: ["Table"],
  description: "This component adds a single line of text to the table.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=4013-24003",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TableTextProps",
  usage: {
    do: [
      "Use the single line variant for short strings. For example, a name.",
      "Use the multi-line variant for longer strings. For example, a few sentences.",
    ],
    doNot: [
      "Do not populate placeholder text if no text is entered. Instead, leave the field empty.",
    ],
  },
  props: {},
  demo: TableTextDemo,
  demoOptions: {},
  stories: {
    Variants: {
      render: TableTextVariants,
    },
  },
};
