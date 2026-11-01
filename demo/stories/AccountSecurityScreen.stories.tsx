import type {
  AccountPasskey,
  AccountSession,
  LinkedAccount,
  PasswordCardSubmission,
  TwoFactorEnrollment,
} from "@terreno/ui";
import {AccountSecurityScreen, Text} from "@terreno/ui";
import {DateTime} from "luxon";
import {type ReactElement, useCallback, useMemo, useState} from "react";

const PROVIDERS = [{id: "google"}, {id: "github"}, {id: "apple"}];

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** The password and code the demo accepts. */
const DEMO_PASSWORD = "password";
const DEMO_CODE = "123456";

const DEMO_ENROLLMENT: TwoFactorEnrollment = {
  backupCodes: ["k3j9-x2mw", "p8q4-7ztn", "c5v1-h6rd", "m2b8-w9yf", "t4n7-a3ke", "r6s2-u8gq"],
  totpURI:
    "otpauth://totp/Terreno:ada%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Terreno&digits=6&period=30",
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects a wrong password the way a real screen would after Better Auth refuses it. */
const checkPassword = (password?: string): void => {
  if (password !== DEMO_PASSWORD) {
    throw new Error(`Invalid password. In this demo, the password is "${DEMO_PASSWORD}".`);
  }
};

const buildAccounts = (): LinkedAccount[] => [
  {
    accountId: "g-1",
    email: "ada@example.com",
    id: "acc-google",
    linkedAt: "2026-03-03T12:00:00.000Z",
    providerId: "google",
  },
  {accountId: "u-1", id: "acc-credential", providerId: "credential"},
];

const buildPasskeys = (): AccountPasskey[] => [
  {
    backedUp: true,
    createdAt: "2026-03-03T12:00:00.000Z",
    id: "pk-laptop",
    name: "Work laptop",
  },
];

/** Sessions with times relative to when the story renders. */
const buildSessions = (): AccountSession[] => {
  const now = DateTime.now();
  return [
    {
      createdAt: now.minus({days: 9}).toISO() ?? undefined,
      id: "s-current",
      ipAddress: "203.0.113.4",
      location: "Denver, US",
      updatedAt: now.minus({hours: 2}).toISO() ?? undefined,
      userAgent: CHROME_MAC,
    },
    {
      createdAt: now.minus({days: 3}).toISO() ?? undefined,
      id: "s-phone",
      ipAddress: "198.51.100.7",
      location: "Denver, US",
      updatedAt: now.minus({minutes: 12}).toISO() ?? undefined,
      userAgent: SAFARI_IPHONE,
    },
  ];
};

/**
 * Every card with a fake auth client: link and unlink providers, change the password ("password"
 * is the current one), add and remove passkeys, turn on two-factor (password "password", code
 * "123456"), and sign out the other session.
 */
export const AccountSecurityScreenDemo: React.FC = (): ReactElement => {
  const [accounts, setAccounts] = useState<LinkedAccount[]>(buildAccounts);
  const [passkeys, setPasskeys] = useState<AccountPasskey[]>(buildPasskeys);
  const [sessions, setSessions] = useState<AccountSession[]>(buildSessions);
  const [isTwoFactorEnabled, setIsTwoFactorEnabled] = useState(false);
  const hasPassword = accounts.some((account) => account.providerId === "credential");

  // A real screen calls authClient.linkSocial({provider, callbackURL}).
  const handleLink = useCallback(async (providerId: string): Promise<void> => {
    await wait(600);
    setAccounts((current) => [
      ...current,
      {
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

  // A real screen calls authClient.changePassword, or a server route for setPassword.
  const handlePassword = useCallback(async (values: PasswordCardSubmission): Promise<void> => {
    await wait(600);
    if (values.mode === "change") {
      checkPassword(values.currentPassword);
    }
  }, []);

  const handleAddPasskey = useCallback(async (name?: string): Promise<void> => {
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

  const handleRenamePasskey = useCallback(async (id: string, name: string): Promise<void> => {
    await wait(400);
    setPasskeys((current) =>
      current.map((passkey) => (passkey.id === id ? {...passkey, name} : passkey))
    );
  }, []);

  const handleRemovePasskey = useCallback(async (removed: AccountPasskey): Promise<void> => {
    await wait(600);
    setPasskeys((current) => current.filter((passkey) => passkey.id !== removed.id));
  }, []);

  const handleStartEnroll = useCallback(async (password?: string): Promise<TwoFactorEnrollment> => {
    await wait(500);
    checkPassword(password);
    return DEMO_ENROLLMENT;
  }, []);

  const handleVerify = useCallback(async (code: string): Promise<void> => {
    await wait(500);
    if (code !== DEMO_CODE) {
      throw new Error(`That code didn't work. In this demo, the code is ${DEMO_CODE}.`);
    }
    setIsTwoFactorEnabled(true);
  }, []);

  const handleDisableTwoFactor = useCallback(async (password?: string): Promise<void> => {
    await wait(500);
    checkPassword(password);
    setIsTwoFactorEnabled(false);
  }, []);

  const handleRevoke = useCallback(async (revoked: AccountSession): Promise<void> => {
    await wait(600);
    setSessions((current) => current.filter((session) => session.id !== revoked.id));
  }, []);

  const handleRevokeOthers = useCallback(async (): Promise<void> => {
    await wait(800);
    setSessions((current) => current.filter((session) => session.id === "s-current"));
  }, []);

  return (
    <AccountSecurityScreen
      description="Manage how you sign in and where you're signed in."
      linkedAccounts={{
        accounts,
        onLink: handleLink,
        onUnlink: handleUnlink,
        providers: PROVIDERS,
      }}
      passkeys={{
        onAdd: handleAddPasskey,
        onRemove: handleRemovePasskey,
        onRename: handleRenamePasskey,
        passkeys,
      }}
      password={{hasPassword, onSubmit: handlePassword}}
      sessions={{
        currentSessionId: "s-current",
        onRevoke: handleRevoke,
        onRevokeOthers: handleRevokeOthers,
        sessions,
      }}
      twoFactor={{
        enabled: isTwoFactorEnabled,
        hasPassword,
        onDisable: handleDisableTwoFactor,
        onStartEnroll: handleStartEnroll,
        onVerify: handleVerify,
      }}
      withPage={false}
    />
  );
};

/**
 * An app with passkeys and two-factor turned off: their props are left out, so their cards are
 * hidden.
 */
export const AccountSecurityScreenFeaturesOff: React.FC = (): ReactElement => {
  const sessions = useMemo(buildSessions, []);
  return (
    <AccountSecurityScreen
      header={<Text color="secondaryLight">Signed in as ada@example.com</Text>}
      linkedAccounts={{
        accounts: buildAccounts(),
        onLink: async (): Promise<void> => {},
        onUnlink: async (): Promise<void> => {},
        providers: PROVIDERS,
      }}
      password={{hasPassword: true, onSubmit: async (): Promise<void> => {}}}
      sessions={{
        currentSessionId: "s-current",
        onRevoke: async (): Promise<void> => {},
        onRevokeOthers: async (): Promise<void> => {},
        sessions,
      }}
      withPage={false}
    />
  );
};

/** The data the cards need is still loading. */
export const AccountSecurityScreenLoading: React.FC = (): ReactElement => {
  return <AccountSecurityScreen isLoading withPage={false} />;
};

/** Loading failed; Try again shows the loading state, then the cards. */
export const AccountSecurityScreenError: React.FC = (): ReactElement => {
  const [state, setState] = useState<"error" | "loading" | "loaded">("error");

  const handleRetry = useCallback((): void => {
    setState("loading");
    setTimeout(() => setState("loaded"), 1000);
  }, []);

  return (
    <AccountSecurityScreen
      error={state === "error" ? "We couldn't load your security settings." : undefined}
      isLoading={state === "loading"}
      onRetry={handleRetry}
      passkeys={{passkeys: buildPasskeys()}}
      withPage={false}
    />
  );
};

/** The screen as its own route: it wraps itself in a scrolling Page (the default). */
export const AccountSecurityScreenAsPage: React.FC = (): ReactElement => {
  const sessions = useMemo(buildSessions, []);
  return (
    <AccountSecurityScreen
      passkeys={{
        onAdd: async (): Promise<void> => {},
        onRemove: async (): Promise<void> => {},
        onRename: async (): Promise<void> => {},
        passkeys: buildPasskeys(),
      }}
      sessions={{
        currentSessionId: "s-current",
        onRevoke: async (): Promise<void> => {},
        onRevokeOthers: async (): Promise<void> => {},
        sessions,
      }}
    />
  );
};
