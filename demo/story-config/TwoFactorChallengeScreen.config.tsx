import type {DemoConfiguration} from "@config";
import {TwoFactorChallengeScreen} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  TwoFactorChallengeScreenBackupCode,
  TwoFactorChallengeScreenDemo,
  TwoFactorChallengeScreenError,
  TwoFactorChallengeScreenLoading,
} from "../stories/TwoFactorChallengeScreen.stories";

const renderTwoFactorChallengeScreenDemo = (): ReactElement => <TwoFactorChallengeScreenDemo />;

export const TwoFactorChallengeScreenConfiguration: DemoConfiguration = {
  usageExample:
    'import {TwoFactorChallengeScreen} from "@terreno/ui";\n\n<TwoFactorChallengeScreen onSubmit={({code, kind, trustDevice}) => verify({code, kind, trustDevice})} trustDeviceDays={30} />',
  name: "TwoFactorChallengeScreen",
  component: TwoFactorChallengeScreen,
  related: ["OtpField", "LoginScreen"],
  description:
    "Second sign-in step: an authenticator code or a backup code, with Trust this device checked by default. Presentational: it reports {code, kind, trustDevice} through onSubmit.",
  a11yNotes: [
    "The error is an alert, so screen readers announce a rejected code at once.",
    "The trust-device control is a checkbox labelled Trust this device. The 30-day sentence is helper text.",
    "A rejected code clears the cells and returns focus to the first one.",
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
  interfaceName: "TwoFactorChallengeScreenProps",
  usage: {
    do: [
      "Pass trustDeviceDays only when the backend trusts devices (Better Auth: 30 days by default).",
      "Pass onCancel so users without their device can go back and pick another method.",
    ],
    doNot: [
      "Do not keep the rejected code: set error and let the screen clear it.",
    ],
  },
  props: {},
  demo: renderTwoFactorChallengeScreenDemo,
  demoOptions: {size: "lg"},
  stories: {
    "Authenticator code": {
      description: "Enter the code from the authenticator app. Trust this device starts checked.",
      render: () => <TwoFactorChallengeScreenDemo />,
    },
    "Wrong code": {
      description: "A rejected authenticator code shows a fixed explanation under the cells.",
      render: () => <TwoFactorChallengeScreenError />,
    },
    "Backup code": {
      description: "One-time backup code. Dashes and spaces are optional.",
      render: () => <TwoFactorChallengeScreenBackupCode />,
    },
    Loading: {render: () => <TwoFactorChallengeScreenLoading />},
  },
};
