import type {DemoConfiguration} from "@config";
import {
  UnifiedAddressAutoCompleteFieldDemo,
  UnifiedAddressAutoCompleteFieldDisabled,
} from "@stories/UnifiedAddressAutoCompleteField.stories";
import {UnifiedAddressAutoCompleteField} from "@terreno/ui";

export const UnifiedAddressAutoCompleteFieldConfiguration: DemoConfiguration = {
  usageExample: "import {UnifiedAddressAutoCompleteField} from \"@terreno/ui\";\n\n<UnifiedAddressAutoCompleteField />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: ["Component", "Form"],
  component: UnifiedAddressAutoCompleteField,
  demo: () => <UnifiedAddressAutoCompleteFieldDemo />,
  demoOptions: {size: "lg"},
  description:
    "Address field that uses Places when a Google key is present, otherwise a text field.",
  interfaceName: "AddressAutocompleteProps",
  name: "UnifiedAddressAutoCompleteField",
  props: {},
  related: ["AddressField", "WebAddressAutocomplete"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Disabled: {render: () => <UnifiedAddressAutoCompleteFieldDisabled />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
