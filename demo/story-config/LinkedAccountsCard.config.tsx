import type {DemoConfiguration} from "@config";
import {LinkedAccountsCard} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  LinkedAccountsCardDemo,
  LinkedAccountsCardError,
  LinkedAccountsCardGenericProvider,
  LinkedAccountsCardLastMethod,
} from "../stories/LinkedAccountsCard.stories";

const renderLinkedAccountsCardDemo = (): ReactElement => <LinkedAccountsCardDemo />;

export const LinkedAccountsCardConfiguration: DemoConfiguration = {
  usageExample:
    'import {LinkedAccountsCard} from "@terreno/ui";\n\n<LinkedAccountsCard accounts={accounts} providers={[{id: "google"}, {id: "github"}]} onLink={(providerId) => authClient.linkSocial({provider: providerId, callbackURL})} onUnlink={(_providerId, account) => authClient.unlinkAccount({accountId: account.id})} />',
  name: "LinkedAccountsCard",
  component: LinkedAccountsCard,
  related: ["PasswordCard", "SocialLoginButton", "LoginScreen"],
  description:
    "Account security card listing each sign-in provider as linked (email and linked date) or not, with Link and a confirmed Unlink. Unlink is disabled with an explanation when it would remove the user's last way to sign in. Presentational: it reports onLink(providerId) and onUnlink(providerId, account).",
  a11yNotes: [
    'Link and Unlink buttons are named after their provider ("Unlink Google").',
    "A disabled Unlink has a visible sentence explaining why, not only a greyed-out button.",
    "Errors are alerts, so screen readers announce a failed link or unlink at once.",
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
  interfaceName: "LinkedAccountsCardProps",
  usage: {
    do: [
      'Pass every account from listAccounts, including "credential": the password counts as a sign-in method.',
      "Pass account.id (Better Auth's account row id) to unlinkAccount({accountId}), not the provider's accountId.",
      "Pass passkeys as otherMethodCount only when the server sets accountLinking.allowUnlinkingAll; Better Auth otherwise refuses to unlink the last account.",
    ],
    doNot: [
      "Do not set canUnlinkLast unless the user has another way back in, such as password reset by email.",
    ],
  },
  props: {},
  demo: renderLinkedAccountsCardDemo,
  demoOptions: {size: "lg"},
  stories: {
    "Link and unlink": {
      description: "Linking and unlinking update the list after a short delay.",
      render: () => <LinkedAccountsCardDemo />,
    },
    "Last sign-in method": {render: () => <LinkedAccountsCardLastMethod />},
    "Generic provider": {render: () => <LinkedAccountsCardGenericProvider />},
    Error: {render: () => <LinkedAccountsCardError />},
  },
};
