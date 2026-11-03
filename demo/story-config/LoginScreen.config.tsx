import {DemoConfiguration} from "@config";
import {LoginScreen} from "@terreno/ui";
import React, {type ReactElement} from "react";

import {
  LoginScreenAnotherWay,
  LoginScreenCancelled,
  LoginScreenContinueAs,
  LoginScreenContinueEmail,
  LoginScreenDemo,
  LoginScreenEditAccounts,
  LoginScreenLastUsedProvider,
  LoginScreenNotice,
  LoginScreenPasskey,
  LoginScreenReturning,
  LoginScreenSigningIn,
  LoginScreenWithProviders,
  LoginScreenWrongPassword,
} from "../stories/LoginScreen.stories";

const renderLoginScreenDemo = (): ReactElement => <LoginScreenDemo />;

export const LoginScreenConfiguration: DemoConfiguration = {
  usageExample: "import {LoginScreen} from \"@terreno/ui\";\n\n<LoginScreen />",
  name: "LoginScreen",
  component: LoginScreen,
  related: ["Button", "Text field", "SignUpScreen"],
  description:
    "Login screen with email/password, outline method pills, a continue-as list, and one feedback banner. Presentational: it renders what it is given.",
  a11yNotes: [
    "Continue rows expose \"Continue as {name}\" (or \"Continue with {method}\") as their accessible name.",
    "A warning or error notice is an alert. An info notice is a status region and can be dismissed.",
    "The last-used pill is text, so it is read with the method it marks.",
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
    "Returning user": {
      description: "Accounts on this device. Other methods stay behind Sign in another way.",
      render: () => <LoginScreenReturning />,
    },
    "First visit": {
      description: "No saved accounts. The last-used provider leads the method pills.",
      render: () => <LoginScreenLastUsedProvider />,
    },
    "Sign in another way": {
      description: "Returning user with the other methods expanded.",
      render: () => <LoginScreenAnotherWay />,
    },
    "Edit accounts": {
      description: "Remembered accounts can be removed from this device. Sessions cannot.",
      render: () => <LoginScreenEditAccounts />,
    },
    "Continue with email": {
      description: "Password step after choosing a remembered email account.",
      render: () => <LoginScreenContinueEmail />,
    },
    "Signing in": {
      description: "The submit button reads Signing in and the fields are disabled.",
      render: () => <LoginScreenSigningIn />,
    },
    "Sign-in cancelled": {
      description: "An info banner after the user closes a provider prompt.",
      render: () => <LoginScreenCancelled />,
    },
    "Account not linked": {
      description: "Warning banner with an action that focuses the original method.",
      render: () => <LoginScreenNotice />,
    },
    "Wrong password": {
      description: "The mismatch is shown on the password field.",
      render: () => <LoginScreenWrongPassword />,
    },
    "With providers": {
      description: "Branded Google, GitHub and Apple pills plus a generic Mock OIDC provider.",
      render: () => <LoginScreenWithProviders />,
    },
    "Last used passkey": {
      description: "A passkey was used last, so that pill leads.",
      render: () => <LoginScreenPasskey />,
    },
    "Continue as": {
      description: "A signed-in session and two remembered accounts, one without a remembered identity.",
      render: () => <LoginScreenContinueAs />,
    },
  },
};
