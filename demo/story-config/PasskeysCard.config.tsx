import type {DemoConfiguration} from "@config";
import {PasskeysCard} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  PasskeysCardDemo,
  PasskeysCardEmpty,
  PasskeysCardError,
  PasskeysCardUnsupported,
} from "../stories/PasskeysCard.stories";

const renderPasskeysCardDemo = (): ReactElement => <PasskeysCardDemo />;

export const PasskeysCardConfiguration: DemoConfiguration = {
  usageExample: `import {PasskeysCard} from "@terreno/ui";

// The Better Auth client resolves {data, error} rather than throwing; throw so the card shows it.
<PasskeysCard
  passkeys={passkeys}
  onAdd={async (name) => {
    const {error} = await authClient.passkey.addPasskey({name});
    if (error) {
      throw new Error(error.message ?? "Couldn't add a passkey.");
    }
  }}
  onRename={async (id, name) => {
    const {error} = await authClient.passkey.updatePasskey({id, name});
    if (error) {
      throw new Error(error.message ?? "Couldn't rename that passkey.");
    }
  }}
  onRemove={async (passkey) => {
    const {error} = await authClient.passkey.deletePasskey({id: passkey.id});
    if (error) {
      throw new Error(error.message ?? "Couldn't remove that passkey.");
    }
  }}
/>`,
  name: "PasskeysCard",
  component: PasskeysCard,
  related: ["LinkedAccountsCard", "SessionsCard", "PasswordCard"],
  description:
    'Account security card listing the user\'s passkeys with their created and last-used dates and a "Synced" badge for backed-up ones. Add asks for an optional name, Rename edits it in a dialog, and Remove asks for confirmation. supported={false} hides Add and explains that the device can\'t create passkeys. Presentational: it reports onAdd(name?), onRename(id, name) and onRemove(passkey).',
  a11yNotes: [
    'Rename and Remove are named after their passkey ("Remove passkey Work laptop").',
    "Removing asks for confirmation in a modal with Remove and Cancel buttons.",
    "Errors are alerts, so screen readers announce a cancelled or failed action at once.",
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
  interfaceName: "PasskeysCardProps",
  usage: {
    do: [
      "Pass authClient.passkey.listUserPasskeys() data as passkeys; its items fit AccountPasskey.",
      "Set supported from a WebAuthn check (for example, window.PublicKeyCredential) so devices that can't create passkeys don't offer Add.",
      "Refetch the list after onAdd, onRename or onRemove resolves.",
      "Throw from each callback when the Better Auth call resolves an error; the client does not reject.",
      "Fill authenticatorName from getAuthenticatorName(aaguid) so unnamed passkeys read as their authenticator.",
    ],
    doNot: [
      "Do not show lastUsedAt unless the app records it: Better Auth does not store a last-used time.",
    ],
  },
  props: {},
  demo: renderPasskeysCardDemo,
  demoOptions: {size: "lg"},
  stories: {
    "Add, rename and remove": {
      description: "Each action updates the list after a short delay.",
      render: () => <PasskeysCardDemo />,
    },
    Empty: {render: () => <PasskeysCardEmpty />},
    "Unsupported device": {render: () => <PasskeysCardUnsupported />},
    Error: {render: () => <PasskeysCardError />},
  },
};
