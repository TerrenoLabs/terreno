import {DemoConfiguration} from "@config";
import {AddressFieldDemo} from "@stories/AddressField.stories";
import {Field} from "@terreno/ui";

export const AddressFieldConfiguration: DemoConfiguration = {
  usageExample: "import {Field} from \"@terreno/ui\";\n\n<Field />",
  name: "AddressField",
  related: ["Tap to edit"],
  description: "Set/Display a user's address",
  category: ["Pattern", "Form"],
  component: Field,
  status: {
    documentation: "planned",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r/Flourish-Health-Design-System?node-id=341-17616&t=JxZ416NV0ETdTCi6-0",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  usage: {
    do: ["Use to capture users' addresses"],
    doNot: ["N/A"],
  },
  a11yNotes: [""],
  interfaceName: "FieldProps",
  props: {},
  demo: AddressFieldDemo,
  demoOptions: {
    size: "md",
    controls: {
      googleMapsApiKey: {
        type: "text",
        defaultValue: "",
      },
      includeCounty: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  stories: {},
};
