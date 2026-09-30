import type {DemoConfiguration} from "@config";
import {
  SocialLoginButtonDemo,
  SocialLoginButtonOutline,
  SocialLoginButtonProviders,
  SocialLoginButtonStates,
} from "@stories/SocialLoginButton.stories";
import {SocialLoginButton} from "@terreno/ui";

export const SocialLoginButtonConfiguration: DemoConfiguration = {
  usageExample: "import {SocialLoginButton} from \"@terreno/ui\";\n\n<SocialLoginButton />",
  name: "SocialLoginButton",
  component: SocialLoginButton,
  related: ["LoginScreen", "Button"],
  description:
    "Branded OAuth login button for Google, GitHub, and Apple. Primary uses provider colors; outline uses a light background.",
  a11yNotes: ["Each button should expose an accessible name that includes the provider."],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "SocialLoginButtonProps",
  usage: {
    do: [
      "Use one button per provider.",
      "Wire onPress to Better Auth signIn.social.",
    ],
    doNot: ["Do not invent a fourth provider without adding brand colors."],
  },
  props: {},
  demo: () => <SocialLoginButtonDemo />,
  demoOptions: {size: "md"},
  stories: {
    Providers: {
      description: "Google, GitHub, and Apple in the primary variant.",
      render: () => <SocialLoginButtonProviders />,
    },
    Outline: {
      description: "All three providers in the outline variant.",
      render: () => <SocialLoginButtonOutline />,
    },
    States: {
      description: "Loading and disabled.",
      render: () => <SocialLoginButtonStates />,
    },
  },
};
