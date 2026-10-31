import type {DemoConfiguration} from "@config";
import {SessionsCard} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  SessionsCardDemo,
  SessionsCardError,
  SessionsCardOnlyThisDevice,
} from "../stories/SessionsCard.stories";

const renderSessionsCardDemo = (): ReactElement => <SessionsCardDemo />;

export const SessionsCardConfiguration: DemoConfiguration = {
  usageExample: `import {SessionsCard} from "@terreno/ui";

// The Better Auth client resolves {data, error} rather than throwing; throw so the card shows it.
<SessionsCard
  sessions={sessions}
  currentSessionId={session.id}
  onRevoke={async (revoked) => {
    if (!revoked.token) {
      throw new Error("This session can't be signed out.");
    }
    const {error} = await authClient.revokeSession({token: revoked.token});
    if (error) {
      throw new Error(error.message ?? "Couldn't sign out that session.");
    }
  }}
  onRevokeOthers={async () => {
    const {error} = await authClient.revokeOtherSessions();
    if (error) {
      throw new Error(error.message ?? "Couldn't sign out your other sessions.");
    }
  }}
/>`,
  name: "SessionsCard",
  component: SessionsCard,
  related: ["PasskeysCard", "PasswordCard", "LinkedAccountsCard"],
  description:
    'Account security card listing signed-in sessions: device and browser parsed from the user agent, location and IP when known, "Signed in" (createdAt) and "Last refreshed" (updatedAt) as relative times that update every minute. Better Auth moves updatedAt only once per session.updateAge, so it is not shown as live activity. The current session comes first, marked "This device" and "Active now", and has no Sign out button. "Sign out everywhere else" asks for confirmation and is disabled when no other session exists. Presentational: it reports onRevoke(session) and onRevokeOthers().',
  a11yNotes: [
    'Each Sign out button names its session and when it signed in ("Sign out Safari on iOS, signed in 3 days ago").',
    '"This device" is visible text, not only an icon.',
    "Errors are alerts, so screen readers announce a failed sign-out at once.",
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
  interfaceName: "SessionsCardProps",
  usage: {
    do: [
      "Pass authClient.listSessions() data as sessions; its items fit AccountSession.",
      "Throw from onRevoke and onRevokeOthers when the Better Auth call resolves an error; the client does not reject.",
      "Pass currentSessionId (or currentSessionToken) from the current session so it is marked and protected.",
      "Pass now in tests and screenshots so relative times stay stable.",
    ],
    doNot: [
      "Do not use onRevoke to sign out the current device; use your sign-out action for that.",
    ],
  },
  props: {},
  demo: renderSessionsCardDemo,
  demoOptions: {size: "lg"},
  stories: {
    "Sign out sessions": {
      description: "Signing out updates the list after a short delay.",
      render: () => <SessionsCardDemo />,
    },
    "Only this device": {render: () => <SessionsCardOnlyThisDevice />},
    Error: {render: () => <SessionsCardError />},
  },
};
