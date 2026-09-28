import type {DemoConfiguration} from "@config";
import {SignUpScreenDemo, SignUpScreenWithOauth} from "@stories/SignUpScreen.stories";
import {SignUpScreen} from "@terreno/ui";

export const SignUpScreenConfiguration: DemoConfiguration = {
  usageExample: "import {SignUpScreen} from \"@terreno/ui\";\n\n<SignUpScreen />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: ["Component", "Form"],
  component: SignUpScreen,
  demo: () => <SignUpScreenDemo />,
  demoOptions: {size: "lg"},
  description:
    "Full sign-up form. LoginScreen already covers auth chrome; this is the create-account path.",
  interfaceName: "SignUpScreenProps",
  name: "SignUpScreen",
  props: {},
  related: ["LoginScreen", "OAuthButtons"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    WithOauth: {render: () => <SignUpScreenWithOauth />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
