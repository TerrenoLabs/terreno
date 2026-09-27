import {DemoConfiguration} from "@config";
import {LoginScreen} from "@terreno/ui";
import React, {type ReactElement} from "react";

import {LoginScreenDemo} from "../stories/LoginScreen.stories";

const renderLoginScreenDemo = (): ReactElement => <LoginScreenDemo />;

export const LoginScreenConfiguration: DemoConfiguration = {
  usageExample: "import {LoginScreen} from \"@terreno/ui\";\n\n<LoginScreen />",
  name: "LoginScreen",
  component: LoginScreen,
  related: ["Button", "Text field", "SignUpScreen"],
  description:
    "Email/password login screen with optional forgot-password and sign-up actions.",
  a11yNotes: [],
  category: "Pattern",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "LoginScreenProps",
  usage: {
    do: ["Pass onForgotPassword (or onForgotPasswordPress) to show the reset link."],
    doNot: ["Do not show a reset link when no callback is provided."],
  },
  props: {},
  demo: renderLoginScreenDemo,
  demoOptions: {size: "lg"},
  stories: {
    "With forgot password": {
      render: () => <LoginScreenDemo />,
    },
  },
};
