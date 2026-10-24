import type {AccountSession} from "@terreno/ui";
import {Box, SessionsCard} from "@terreno/ui";
import {DateTime} from "luxon";
import {type ReactElement, useCallback, useMemo, useState} from "react";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
const IOS_APP = "Example/1 CFNetwork/1496.0.7 Darwin/23.5.0";

/** Sessions with sign-in and refresh times relative to when the story renders. */
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
    {
      createdAt: now.minus({days: 20}).toISO() ?? undefined,
      id: "s-app",
      ipAddress: "198.51.100.7",
      updatedAt: now.minus({days: 1}).toISO() ?? undefined,
      userAgent: IOS_APP,
    },
    {
      createdAt: now.minus({days: 12}).toISO() ?? undefined,
      id: "s-windows",
      ipAddress: "192.0.2.80",
      location: "Lisbon, PT",
      updatedAt: now.minus({days: 6}).toISO() ?? undefined,
      userAgent: FIREFOX_WINDOWS,
    },
  ];
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Signing out one session, or every other session, updates the list after a short delay. */
export const SessionsCardDemo: React.FC = (): ReactElement => {
  const [sessions, setSessions] = useState<AccountSession[]>(buildSessions);

  // A real screen calls authClient.revokeSession({token: session.token}).
  const handleRevoke = useCallback(async (revoked: AccountSession): Promise<void> => {
    await wait(600);
    setSessions((current) => current.filter((session) => session.id !== revoked.id));
  }, []);

  // A real screen calls authClient.revokeOtherSessions().
  const handleRevokeOthers = useCallback(async (): Promise<void> => {
    await wait(800);
    setSessions((current) => current.filter((session) => session.id === "s-current"));
  }, []);

  return (
    <Box maxWidth={560} width="100%">
      <SessionsCard
        currentSessionId="s-current"
        onRevoke={handleRevoke}
        onRevokeOthers={handleRevokeOthers}
        sessions={sessions}
      />
    </Box>
  );
};

/** Only this device is signed in, so "Sign out everywhere else" is disabled. */
export const SessionsCardOnlyThisDevice: React.FC = (): ReactElement => {
  const sessions = useMemo(() => buildSessions().slice(0, 1), []);
  return (
    <Box maxWidth={560} width="100%">
      <SessionsCard
        currentSessionId="s-current"
        onRevoke={async (): Promise<void> => {}}
        onRevokeOthers={async (): Promise<void> => {}}
        sessions={sessions}
      />
    </Box>
  );
};

/** Signing out a session rejects, and the card shows the error. */
export const SessionsCardError: React.FC = (): ReactElement => {
  const sessions = useMemo(() => buildSessions().slice(0, 2), []);
  return (
    <Box maxWidth={560} width="100%">
      <SessionsCard
        currentSessionId="s-current"
        onRevoke={async (): Promise<void> => {
          await wait(400);
          throw new Error("That session has already ended.");
        }}
        onRevokeOthers={async (): Promise<void> => {}}
        sessions={sessions}
      />
    </Box>
  );
};
