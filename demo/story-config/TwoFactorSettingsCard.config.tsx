import type {DemoConfiguration} from "@config";
import {TwoFactorSettingsCard} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  TwoFactorSettingsCardDemo,
  TwoFactorSettingsCardLowCodes,
  TwoFactorSettingsCardNeedsPassword,
  TwoFactorSettingsCardPasswordless,
} from "../stories/TwoFactorSettingsCard.stories";

const renderTwoFactorSettingsCardDemo = (): ReactElement => <TwoFactorSettingsCardDemo />;

export const TwoFactorSettingsCardConfiguration: DemoConfiguration = {
  usageExample: `import {TwoFactorSettingsCard, hasPasswordCredential} from "@terreno/ui";

// The Better Auth client resolves {data, error} rather than throwing; throw so the card shows it.
<TwoFactorSettingsCard
  enabled={Boolean(session.data?.user.twoFactorEnabled)}
  hasPassword={hasPasswordCredential(accounts)}
  onStartEnroll={async (password) => {
    const {data, error} = await authClient.twoFactor.enable({password: password ?? ""});
    // enable() resolves {method: "otp"} for the email/SMS OTP method; only TOTP has a URI.
    if (error || !data || !("totpURI" in data)) {
      throw new Error(error?.message ?? "Couldn't start two-factor setup.");
    }
    return {backupCodes: data.backupCodes, totpURI: data.totpURI};
  }}
  onVerify={async (code) => {
    const {error} = await authClient.twoFactor.verifyTotp({code});
    if (error) {
      throw new Error(error.message ?? "That code didn't work.");
    }
  }}
  onRegenerateBackupCodes={async (password) => {
    const {data, error} = await authClient.twoFactor.generateBackupCodes({password: password ?? ""});
    if (error || !data) {
      throw new Error(error?.message ?? "Couldn't create new backup codes.");
    }
    return data.backupCodes;
  }}
  onDisable={async (password) => {
    const {error} = await authClient.twoFactor.disable({password: password ?? ""});
    if (error) {
      throw new Error(error.message ?? "Couldn't turn off two-factor authentication.");
    }
  }}
/>`,
  name: "TwoFactorSettingsCard",
  component: TwoFactorSettingsCard,
  related: ["TwoFactorChallengeScreen", "OtpField", "PasswordCard", "PasskeysCard"],
  description:
    'Account security card that turns authenticator-app two-factor authentication on and off. Turning on walks through four steps: confirm the password, scan a QR code (or type the setup key under it), enter a code with OtpField, then save the backup codes (copy, and download on web or share on native), with Finish gated on "I saved these backup codes". Once on, it offers new backup codes (password, then the new codes with the same gate) and Turn off (password, then a destructive confirm), and warns when fewer than 3 backup codes remain. Presentational: it reports onStartEnroll(password?), onVerify(code), onRegenerateBackupCodes(password?) and onDisable(password?).',
  a11yNotes: [
    'Each enrollment step says where the user is ("Step 2 of 4"). On a step change, web moves focus to the step heading (or the field on the password and code steps) and native announces the step.',
    'The QR code is an image named "QR code for your authenticator app"; the setup key under it is text with a Copy key button, for users who can\'t scan.',
    'Copy results ("Copied", "Couldn\'t copy") sit in a polite live region and are announced on iOS, where VoiceOver ignores live regions.',
    '"I saved these backup codes" is a role="checkbox" control that Space toggles; Finish stays disabled until it is checked.',
    "Errors are alerts, so screen readers announce a wrong password or code at once.",
  ],
  category: ["Pattern"],
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TwoFactorSettingsCardProps",
  usage: {
    do: [
      "Narrow authClient.twoFactor.enable() data before returning it from onStartEnroll: it resolves {method: \"otp\"} for the OTP method and {method: \"totp\", totpURI, backupCodes} for TOTP.",
      "Pass hasPassword={hasPasswordCredential(accounts)} so a user who signed up with a social provider is asked to set a password first.",
      "Refetch the session after onVerify and onDisable resolve so enabled follows Better Auth's user.twoFactorEnabled.",
      "Throw from each callback when the Better Auth call resolves an error; the client does not reject.",
    ],
    doNot: [
      "Do not set requirePassword={false} unless the server's two-factor plugin sets allowPasswordless and the user has no password; Better Auth otherwise refuses calls without one.",
      "Do not log or store the backup codes or the totpURI; they are secrets.",
    ],
  },
  props: {},
  demo: renderTwoFactorSettingsCardDemo,
  demoOptions: {size: "lg"},
  stories: {
    "Turn on, new codes and turn off": {
      description: 'The password is "password" and the code is 123456.',
      render: () => <TwoFactorSettingsCardDemo />,
    },
    "Low on backup codes": {render: () => <TwoFactorSettingsCardLowCodes />},
    "No password yet": {render: () => <TwoFactorSettingsCardNeedsPassword />},
    "Passwordless server": {render: () => <TwoFactorSettingsCardPasswordless />},
  },
};
