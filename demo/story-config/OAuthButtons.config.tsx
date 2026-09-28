import type {DemoConfiguration} from "@config";
import {OAuthButtonsDemo, OAuthButtonsDisabled} from "@stories/OAuthButtons.stories";
import {OAuthButtons} from "@terreno/ui";

export const OAuthButtonsConfiguration: DemoConfiguration = {
  usageExample: "import {OAuthButtons} from \"@terreno/ui\";\n\n<OAuthButtons />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: OAuthButtons,
  demo: () => <OAuthButtonsDemo />,
  demoOptions: {size: "lg"},
  description: "Grouped social login buttons with a divider.",
  interfaceName: "OAuthButtonsProps",
  name: "OAuthButtons",
  props: {},
  related: ["SocialLoginButton", "SignUpScreen"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Disabled: {render: () => <OAuthButtonsDisabled />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
