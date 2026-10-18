import {DemoConfiguration} from "@config";
import {UserInactivityDemo} from "@stories/UserInactivity.stories";
import {UserInactivity} from "@terreno/ui";

export const UserInactivityConfiguration: DemoConfiguration = {
  usageExample: "import {UserInactivity} from \"@terreno/ui\";\n\n<UserInactivity />",
  name: "UserInactivity",
  component: UserInactivity,
  related: ["Modal"],
  description:
    "A component that detects user inactivity by monitoring touch events and keyboard interactions. When the user hasn't interacted with the app for a specified duration, it triggers a callback. This is useful for implementing session timeouts, auto-logout features, or any functionality that depends on user activity state. No demo is available as this component requires app-level integration.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "notSupported",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [
    {
      name: "Original Library",
      link: "https://github.com/jkomyno/react-native-user-inactivity",
    },
  ],
  interfaceName: "UserInactivityProps",
  usage: {
    do: [
      "Wrap your app content with UserInactivity at the root level.",
      "Use appropriate timeout values for your use case (e.g., 5-15 minutes for session timeout).",
      "Handle both active and inactive states in your onAction callback.",
    ],
    doNot: [
      "Do not nest multiple UserInactivity components.",
      "Do not use very short timeout values that may frustrate users.",
    ],
  },
  props: {},
  demo: UserInactivityDemo,
  demoOptions: {},
  stories: {},
};
