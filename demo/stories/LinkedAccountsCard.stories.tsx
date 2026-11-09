import type {LinkedAccount} from "@terreno/ui";
import {Box, LinkedAccountsCard} from "@terreno/ui";
import {DateTime} from "luxon";
import {type ReactElement, useCallback, useState} from "react";

const PROVIDERS = [{id: "google"}, {id: "github"}, {id: "apple"}];

const GOOGLE: LinkedAccount = {
  accountId: "g-1",
  email: "ada@example.com",
  id: "acc-google",
  linkedAt: "2026-03-03T12:00:00.000Z",
  providerId: "google",
};
const CREDENTIAL: LinkedAccount = {
  accountId: "u-1",
  id: "acc-credential",
  providerId: "credential",
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Link and unlink update the list after a short delay, as a real auth client would. */
export const LinkedAccountsCardDemo: React.FC = (): ReactElement => {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([GOOGLE, CREDENTIAL]);

  const handleLink = useCallback(async (providerId: string): Promise<void> => {
    await wait(600);
    setAccounts((current) => [
      ...current,
      {
        accountId: `${providerId}-1`,
        email: "ada@example.com",
        id: `acc-${providerId}-${DateTime.now().toMillis()}`,
        linkedAt: DateTime.now().toISO() ?? undefined,
        providerId,
      },
    ]);
  }, []);

  // A real screen calls authClient.unlinkAccount({accountId: account.id}).
  const handleUnlink = useCallback(
    async (_providerId: string, unlinked: LinkedAccount): Promise<void> => {
      await wait(600);
      setAccounts((current) => current.filter((account) => account.id !== unlinked.id));
    },
    []
  );

  return (
    <Box maxWidth={560} width="100%">
      <LinkedAccountsCard
        accounts={accounts}
        onLink={handleLink}
        onUnlink={handleUnlink}
        providers={PROVIDERS}
      />
    </Box>
  );
};

/** A user who signed up with Google and has no password or passkey: Unlink is disabled. */
export const LinkedAccountsCardLastMethod: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <LinkedAccountsCard
        accounts={[GOOGLE]}
        onLink={async (): Promise<void> => {}}
        onUnlink={async (): Promise<void> => {}}
        providers={PROVIDERS}
      />
    </Box>
  );
};

/** A generic OIDC provider next to the branded ones. */
export const LinkedAccountsCardGenericProvider: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <LinkedAccountsCard
        accounts={[
          CREDENTIAL,
          {accountId: "sso-1", email: "ada@corp.example", id: "acc-sso", providerId: "company-sso"},
        ]}
        onLink={async (): Promise<void> => {}}
        onUnlink={async (): Promise<void> => {}}
        providers={[
          {id: "google"},
          {iconName: "building", id: "company-sso", label: "Company SSO"},
        ]}
      />
    </Box>
  );
};

/** Unlink rejects, and the card shows the error. */
export const LinkedAccountsCardError: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        error="We couldn't reach GitHub. Try again."
        onLink={async (): Promise<void> => {}}
        onUnlink={async (): Promise<void> => {
          await wait(400);
          throw new Error("Unlinking failed. Try again.");
        }}
        providers={PROVIDERS}
      />
    </Box>
  );
};
