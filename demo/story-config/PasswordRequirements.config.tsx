import type {DemoConfiguration} from "@config";
import {
  PasswordRequirementsDemo,
  PasswordRequirementsUnmet,
} from "@stories/PasswordRequirements.stories";
import {PasswordRequirements} from "@terreno/ui";

export const PasswordRequirementsConfiguration: DemoConfiguration = {
  usageExample: "import {PasswordRequirements} from \"@terreno/ui\";\n\n<PasswordRequirements />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: PasswordRequirements,
  demo: () => <PasswordRequirementsDemo />,
  demoOptions: {size: "lg"},
  description: "Checklist of password rules with met/unmet icons.",
  interfaceName: "PasswordRequirementsProps",
  name: "PasswordRequirements",
  props: {},
  related: ["SignUpScreen", "Password field"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Unmet: {render: () => <PasswordRequirementsUnmet />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
