import type {DemoConfiguration} from "@config";
import {OtpField} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  OtpFieldDemo,
  OtpFieldDisabled,
  OtpFieldError,
  OtpFieldFourDigits,
} from "../stories/OtpField.stories";

const renderOtpFieldDemo = (): ReactElement => <OtpFieldDemo />;

export const OtpFieldConfiguration: DemoConfiguration = {
  usageExample:
    'import {OtpField} from "@terreno/ui";\n\n<OtpField autoFocus onComplete={(code) => verify(code)} />',
  name: "OtpField",
  component: OtpField,
  related: ["Text field", "TwoFactorChallengeScreen"],
  description:
    "One-time code input with a cell per digit. Pasting or autofilling a whole code fills every cell, backspace steps back a cell, and onComplete fires when every cell holds a digit.",
  a11yNotes: [
    'The cells sit in a group named "Verification code" (set with accessibilityLabel).',
    'Each cell is labelled "Digit k of N" and opens a numeric keyboard.',
    'Cells carry autocomplete="one-time-code" (web), textContentType="oneTimeCode" (iOS), and "sms-otp" (Android) so the platform offers the code.',
  ],
  category: "Form",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "OtpFieldProps",
  usage: {
    do: [
      "Use onComplete to submit the code as soon as it is entered.",
      "Clear the value after a rejected code so the user can enter a fresh one.",
    ],
    doNot: [
      "Do not use it for backup or recovery codes that contain letters; use a Text field.",
    ],
  },
  props: {},
  demo: renderOtpFieldDemo,
  demoOptions: {},
  stories: {
    "Six digits": {
      description: "Type or paste a code; the result line shows the completed code.",
      render: () => <OtpFieldDemo />,
    },
    "Four digits": {render: () => <OtpFieldFourDigits />},
    Error: {render: () => <OtpFieldError />},
    Disabled: {render: () => <OtpFieldDisabled />},
  },
};
