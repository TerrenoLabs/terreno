import type {DemoConfiguration} from "@config";
import {AccountSecurityScreen} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  AccountSecurityScreenAsPage,
  AccountSecurityScreenDemo,
  AccountSecurityScreenError,
  AccountSecurityScreenFeaturesOff,
  AccountSecurityScreenLoading,
} from "../stories/AccountSecurityScreen.stories";

const renderAccountSecurityScreenDemo = (): ReactElement => <AccountSecurityScreenDemo />;

export const AccountSecurityScreenConfiguration: DemoConfiguration = {
  usageExample: `import {AccountSecurityScreen, hasPasswordCredential} from "@terreno/ui";

// Leave out a card's props to hide it: here passkeys are on and two-factor is off.
<AccountSecurityScreen
  isLoading={isLoading}
  error={loadError}
  onRetry={refetch}
  linkedAccounts={{accounts, providers, onLink, onUnlink}}
  password={{hasPassword: hasPasswordCredential(accounts), onSubmit: onPasswordSubmit}}
  passkeys={{passkeys, onAdd, onRename, onRemove}}
  sessions={{sessions, currentSessionId: session.id, onRevoke, onRevokeOthers}}
/>`,
  name: "AccountSecurityScreen",
  component: AccountSecurityScreen,
  related: [
    "LinkedAccountsCard",
    "PasswordCard",
    "PasskeysCard",
    "TwoFactorSettingsCard",
    "SessionsCard",
  ],
  description:
    'Account security screen composed from the security cards, in order: sign-in methods (LinkedAccountsCard, PasswordCard), PasskeysCard, TwoFactorSettingsCard, SessionsCard. Each card takes its props as one object and renders only when that object is given, so a feature the app turned off hides its card. Adds a "Security" heading, optional description and header, a loading state, and a page-level error with Try again. Wraps itself in a scrolling Page unless withPage is false. Presentational: wire each card\'s callbacks to the auth client, or use the connected screen from @terreno/rtk.',
  a11yNotes: [
    'The loading state is a progressbar named "Loading security settings" with visible text.',
    "The page-level error is an alert, so screen readers announce it at once; Try again is a labeled button.",
    "The title is a level 1 heading and each card's title is level 2, so heading navigation lists Security, then each card.",
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
  interfaceName: "AccountSecurityScreenProps",
  usage: {
    do: [
      "Pass only the props of features the server has on; read them from the methods endpoint.",
      "Use isLoading and error for loading the data, and each card's own error for its actions.",
      "Pass withPage={false} when the screen sits inside your own Page, ScrollView or tabs.",
    ],
    doNot: [
      "Do not pass empty props objects to hide a card; leave the prop out.",
      "Do not nest it in a ScrollView without withPage={false}; scroll views would nest.",
    ],
  },
  props: {},
  demo: renderAccountSecurityScreenDemo,
  demoOptions: {size: "lg"},
  stories: {
    "Every card": {
      description:
        'A fake auth client: the password is "password" and the two-factor code is "123456".',
      render: () => <AccountSecurityScreenDemo />,
    },
    "Passkeys and two-factor off": {render: () => <AccountSecurityScreenFeaturesOff />},
    "As a page": {
      description: "Without withPage={false}, the screen wraps itself in a scrolling Page.",
      render: () => <AccountSecurityScreenAsPage />,
    },
    Loading: {render: () => <AccountSecurityScreenLoading />},
    Error: {
      description: "Try again shows the loading state, then the cards.",
      render: () => <AccountSecurityScreenError />,
    },
  },
};
