import type {AccountPasskey} from "@terreno/ui";
import {Box, PasskeysCard} from "@terreno/ui";
import {DateTime} from "luxon";
import {type ReactElement, useCallback, useState} from "react";

const LAPTOP: AccountPasskey = {
  backedUp: true,
  createdAt: "2026-03-03T12:00:00.000Z",
  id: "pk-laptop",
  lastUsedAt: "2026-03-10T12:00:00.000Z",
  name: "Work laptop",
};
const KEY: AccountPasskey = {
  backedUp: false,
  createdAt: "2026-01-15T12:00:00.000Z",
  id: "pk-key",
  name: "YubiKey",
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Add, rename, and remove update the list after a short delay, as a real auth client would. */
export const PasskeysCardDemo: React.FC = (): ReactElement => {
  const [passkeys, setPasskeys] = useState<AccountPasskey[]>([LAPTOP, KEY]);

  // A real screen calls authClient.passkey.addPasskey({name}), then refetches the list.
  const handleAdd = useCallback(async (name?: string): Promise<void> => {
    await wait(600);
    setPasskeys((current) => [
      ...current,
      {
        backedUp: true,
        createdAt: DateTime.now().toISO() ?? undefined,
        id: `pk-${DateTime.now().toMillis()}`,
        name,
      },
    ]);
  }, []);

  const handleRename = useCallback(async (id: string, name: string): Promise<void> => {
    await wait(400);
    setPasskeys((current) =>
      current.map((passkey) => (passkey.id === id ? {...passkey, name} : passkey))
    );
  }, []);

  const handleRemove = useCallback(async (removed: AccountPasskey): Promise<void> => {
    await wait(600);
    setPasskeys((current) => current.filter((passkey) => passkey.id !== removed.id));
  }, []);

  return (
    <Box maxWidth={560} width="100%">
      <PasskeysCard
        onAdd={handleAdd}
        onRemove={handleRemove}
        onRename={handleRename}
        passkeys={passkeys}
      />
    </Box>
  );
};

/** No passkeys yet. */
export const PasskeysCardEmpty: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <PasskeysCard onAdd={async (): Promise<void> => {}} passkeys={[]} />
    </Box>
  );
};

/** A device that can't create passkeys: Add is hidden, existing passkeys stay manageable. */
export const PasskeysCardUnsupported: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <PasskeysCard
        onAdd={async (): Promise<void> => {}}
        onRemove={async (): Promise<void> => {}}
        onRename={async (): Promise<void> => {}}
        passkeys={[LAPTOP]}
        supported={false}
      />
    </Box>
  );
};

/** Adding rejects, as when the user cancels the browser prompt, and the card shows the error. */
export const PasskeysCardError: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <PasskeysCard
        onAdd={async (): Promise<void> => {
          await wait(400);
          throw new Error("The passkey prompt was cancelled.");
        }}
        onRemove={async (): Promise<void> => {}}
        passkeys={[KEY]}
      />
    </Box>
  );
};
