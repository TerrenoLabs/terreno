import type {DemoConfiguration} from "@config";
import {PasswordCard} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  PasswordCardChange,
  PasswordCardError,
  PasswordCardLoading,
  PasswordCardSet,
} from "../stories/PasswordCard.stories";

const renderPasswordCardDemo = (): ReactElement => <PasswordCardChange />;

export const PasswordCardConfiguration: DemoConfiguration = {
  usageExample:
    'import {PasswordCard} from "@terreno/ui";\n\n<PasswordCard hasPassword={hasPassword} onSubmit={({mode, currentPassword, newPassword, revokeOtherSessions}) => (mode === "change" ? changePassword({currentPassword, newPassword, revokeOtherSessions}) : setPassword({newPassword}))} />',
  name: "PasswordCard",
  component: PasswordCard,
  related: ["LinkedAccountsCard", "PasswordRequirements"],
  description:
    'Account security card for the password. With a password it shows "Change password" (current, new, confirm, and an optional "Sign out of other devices"); without one it shows "Set a password" (new and confirm). Validates length and confirmation inline and reports through onSubmit.',
  a11yNotes: [
    "Inputs carry current-password and new-password autofill hints so password managers fill and save correctly.",
    "Each input has its own accessible name; the sign-out choice is a checkbox with its sentence as the name.",
    "A failed check focuses the first invalid field and announces a summary alert.",
    "A rejected submission is an alert; success is a status message.",
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
  interfaceName: "PasswordCardProps",
  usage: {
    do: [
      'Derive hasPassword from a "credential" account (hasPasswordCredential(accounts)).',
      "Reject onSubmit with a user-facing message, such as a wrong current password.",
    ],
    doNot: ["Do not clear the form on failure: the card keeps it so the user can fix one field."],
  },
  props: {},
  demo: renderPasswordCardDemo,
  demoOptions: {size: "lg"},
  stories: {
    "Change password": {
      description: 'The current password "password123" succeeds; anything else is rejected.',
      render: () => <PasswordCardChange />,
    },
    "Set a password": {render: () => <PasswordCardSet />},
    Error: {render: () => <PasswordCardError />},
    Loading: {render: () => <PasswordCardLoading />},
  },
};
