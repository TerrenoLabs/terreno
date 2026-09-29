import {DemoConfiguration} from "@config";
import {TableTitleDemo, TableTitleExample} from "@stories/TableTitle.stories";
import {TableTitle} from "@terreno/ui";

export const TableTitleConfiguration: DemoConfiguration = {
  usageExample: "import {TableTitle} from \"@terreno/ui\";\n\n<TableTitle />",
  name: "Table title",
  component: TableTitle, // Replace with actual component reference
  related: ["Table"],
  description:
    "This component populates the titles for each table column. They’re ordered by width.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/file/ykXj5qjjtFjOYkAvTasu9r/Flourish-Health-Design-System?type=design&node-id=656%3A24117&mode=design&t=IZ8oGBzUmBzUtZMr-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TableTitleProps",
  usage: {
    do: ["Use the appropriate width for each table column.", "Wrap up to 3 lines of text."],
    doNot: [
      "Do not truncate the text.",
      "Do not wrap 3+ lines. If more room is needed for the title, consider shortening it or adding in a tooltip.",
    ],
  },
  props: {},
  demo: TableTitleDemo,
  demoOptions: {
    controls: {
      title: {
        type: "text",
        defaultValue: "Table Title",
      },
    },
  },
  stories: {
    Example: {
      render: TableTitleExample,
    },
  },
};
