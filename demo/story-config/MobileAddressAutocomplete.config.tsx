import type {DemoConfiguration} from "@config";
import {
  MobileAddressAutocompleteDemo,
  MobileAddressAutocompleteDisabled,
} from "@stories/MobileAddressAutocomplete.stories";
import {MobileAddressAutocomplete} from "@terreno/ui";

export const MobileAddressAutocompleteConfiguration: DemoConfiguration = {
  usageExample: "import {MobileAddressAutocomplete} from \"@terreno/ui\";\n\n<MobileAddressAutocomplete />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: MobileAddressAutocomplete,
  demo: () => <MobileAddressAutocompleteDemo />,
  demoOptions: {size: "lg"},
  description: "Native Places autocomplete. Without a key, stories show the fallback field.",
  interfaceName: "AddressAutocompleteProps",
  name: "MobileAddressAutocomplete",
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
    Disabled: {render: () => <MobileAddressAutocompleteDisabled />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
