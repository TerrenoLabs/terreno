import type {DemoConfiguration} from "@config";
import {
  WebAddressAutocompleteDemo,
  WebAddressAutocompleteDisabled,
} from "@stories/WebAddressAutocomplete.stories";
import {WebAddressAutocomplete} from "@terreno/ui";

export const WebAddressAutocompleteConfiguration: DemoConfiguration = {
  usageExample: "import {WebAddressAutocomplete} from \"@terreno/ui\";\n\n<WebAddressAutocomplete />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: WebAddressAutocomplete,
  demo: () => <WebAddressAutocompleteDemo />,
  demoOptions: {size: "lg"},
  description: "Web Places autocomplete. Without a key, stories show the fallback field.",
  interfaceName: "AddressAutocompleteProps",
  name: "WebAddressAutocomplete",
  props: {},
  related: ["UnifiedAddressAutoCompleteField"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Disabled: {render: () => <WebAddressAutocompleteDisabled />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
