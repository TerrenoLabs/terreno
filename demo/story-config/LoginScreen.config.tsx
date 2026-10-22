import {DemoConfiguration} from "@config";
import {LoginScreen} from "@terreno/ui";
import React, {type ReactElement} from "react";

import {
  LoginScreenContinueAs,
  LoginScreenDemo,
  LoginScreenLastUsedProvider,
  LoginScreenNotice,
  LoginScreenPasskey,
  LoginScreenWithProviders,
} from "../stories/LoginScreen.stories";

const renderLoginScreenDemo = (): ReactElement => <LoginScreenDemo />;

export const LoginScreenConfiguration: DemoConfiguration = {
  usageExample: "import {LoginScreen} from \"@terreno/ui\";\n\n<LoginScreen />",
  name: "LoginScreen",
  component: LoginScreen,
  related: ["Button", "Text field", "SignUpScreen"],
  description:
    "Login screen with email/password, branded and generic OAuth providers, passkeys, a last-used method badge, one-tap \"Continue\" cards for signed-in and remembered accounts, and a notice slot. Presentational: it renders what it is given.",
  a11yNotes: [
    "Continue cards expose \"Continue as {name}\" (or \"Continue with {method}\") as their accessible name.",
    "A warning notice is an alert and an info notice a status region, so screen readers announce linking guidance.",
    "The last-used badge is text, so it is read before the method it marks.",
  ],
  category: ["Pattern", "Form"],
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
    do: [
      "Pass onForgotPassword (or onForgotPasswordPress) to show the reset link.",
      "Pass lastUsedMethod from the device's last sign-in so returning users find their method first.",
      "Use genericProviders for providers without a branded button, such as a company OIDC provider.",
      "Set passkeyAutofill with onPasskeyPress so web browsers offer saved passkeys in the email field.",
    ],
    doNot: [
      "Do not show a reset link when no callback is provided.",
      "Do not pass remembered names, emails or avatars unless the app opted in to remembering identity.",
    ],
  },
  props: {},
  demo: renderLoginScreenDemo,
  demoOptions: {size: "lg"},
  stories: {
    "With forgot password": {
      render: () => <LoginScreenDemo />,
    },
    "With providers": {
      description: "Branded Google, GitHub and Apple buttons plus a generic Mock OIDC provider.",
      render: () => <LoginScreenWithProviders />,
    },
    "Last used provider": {
      description: "GitHub was used last: providers move above the form with GitHub first.",
      render: () => <LoginScreenLastUsedProvider />,
    },
    "Last used passkey": {
      description: "A passkey was used last: the passkey button moves above the form.",
      render: () => <LoginScreenPasskey />,
    },
    "Continue as": {
      description: "A signed-in session and two remembered accounts, one without a remembered identity.",
      render: () => <LoginScreenContinueAs />,
    },
    "Linking notice": {
      description: "Guidance after an account_not_linked error.",
      render: () => <LoginScreenNotice />,
    },
  },
};
