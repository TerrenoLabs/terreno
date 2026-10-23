import {DateTime} from "luxon";
import {type FC, useCallback, useEffect, useMemo, useState} from "react";
import {View} from "react-native";

import {Badge} from "../Badge";
import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import type {IconName} from "../Common";
import {Heading} from "../Heading";
import {Icon} from "../Icon";
import {Modal} from "../Modal";
import {Text} from "../Text";
import {formatRelativeSecurityTime, getRejectionMessage} from "./securityMethods";
import type {AccountSession, SessionsCardProps} from "./securityTypes";
import {getUserAgentLabel, parseUserAgent, type UserAgentDeviceType} from "./userAgent";

/** Pending key for "Sign out everywhere else"; rows use their session id. */
const REVOKE_OTHERS_KEY = "__revoke-others__";

/** How often relative times are recomputed when no `now` is injected. */
const RELATIVE_TIME_REFRESH_MS = 60_000;

const DEVICE_ICONS: Record<UserAgentDeviceType, IconName> = {
  desktop: "desktop",
  mobile: "mobile-screen",
  tablet: "tablet-screen-button",
  unknown: "circle-question",
};

/** One session as a row shows it. */
interface SessionRow {
  session: AccountSession;
  isCurrent: boolean;
  /** "Chrome on macOS", or whichever part is known, or "Unknown device". */
  label: string;
  iconName: IconName;
  /** "Denver, US · 203.0.113.4", or undefined when neither is known. */
  details?: string;
  /** "9 days ago" from `createdAt`, or undefined when unknown. */
  signedIn?: string;
  /** "2 hours ago" from `updatedAt`, or undefined when unknown. */
  lastRefreshed?: string;
}

/** Milliseconds since the epoch for sorting, or 0 when unknown. */
const toMillis = (value?: string | Date): number => {
  if (!value) {
    return 0;
  }
  const date = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value);
  return date.isValid ? date.toMillis() : 0;
};

/** Builds rows with the current session first, then the most recently refreshed. */
const buildRows = ({
  sessions,
  currentSessionId,
  currentSessionToken,
  now,
}: {
  sessions: AccountSession[];
  currentSessionId?: string;
  currentSessionToken?: string;
  now: Date;
}): SessionRow[] => {
  const rows = sessions.map((session): SessionRow => {
    const parsed = parseUserAgent(session.userAgent);
    const isCurrent =
      (currentSessionId !== undefined && session.id === currentSessionId) ||
      (currentSessionToken !== undefined && session.token === currentSessionToken);
    const detailParts = [session.location, session.ipAddress].filter((part): part is string =>
      Boolean(part)
    );
    return {
      details: detailParts.length > 0 ? detailParts.join(" · ") : undefined,
      iconName: DEVICE_ICONS[parsed.deviceType],
      isCurrent,
      label: getUserAgentLabel(parsed),
      lastRefreshed: formatRelativeSecurityTime({now, value: session.updatedAt}),
      session,
      signedIn: formatRelativeSecurityTime({now, value: session.createdAt}),
    };
  });
  return rows.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }
    return (
      toMillis(b.session.updatedAt ?? b.session.createdAt) -
      toMillis(a.session.updatedAt ?? a.session.createdAt)
    );
  });
};

/**
 * Lists the user's signed-in sessions: the device and browser (parsed from the user agent), the
 * location and IP address when known, when each signed in (`createdAt`), and when it was last
 * refreshed (`updatedAt`, which Better Auth only moves once per `session.updateAge`, a day by
 * default, so it is not a live "last active" time). The current session comes first, marked
 * "This device" and "Active now", and can't be signed out on its own here. Every other session
 * has a Sign out button, and "Sign out everywhere else" (with a confirm) ends them all. Relative
 * times are recomputed every minute unless `now` is passed. Presentational: it reports actions
 * through `onRevoke` and `onRevokeOthers` and never calls an auth client.
 *
 * @example
 * ```tsx
 * // The Better Auth client resolves {data, error} rather than throwing; throw so the card
 * // shows the error.
 * <SessionsCard
 *   sessions={sessions}                   // authClient.listSessions() data
 *   currentSessionId={session.data?.session.id}
 *   onRevoke={async (revoked) => {
 *     if (!revoked.token) {
 *       throw new Error("This session can't be signed out.");
 *     }
 *     const {error} = await authClient.revokeSession({token: revoked.token});
 *     if (error) {
 *       throw new Error(error.message ?? "Couldn't sign out that session.");
 *     }
 *   }}
 *   onRevokeOthers={async () => {
 *     const {error} = await authClient.revokeOtherSessions();
 *     if (error) {
 *       throw new Error(error.message ?? "Couldn't sign out your other sessions.");
 *     }
 *   }}
 * />
 * ```
 */
export const SessionsCard: FC<SessionsCardProps> = ({
  sessions,
  currentSessionId,
  currentSessionToken,
  onRevoke,
  onRevokeOthers,
  now,
  error,
  disabled = false,
  title = "Where you're signed in",
  description = "Sign out of any device you don't recognize.",
  testID = "sessions-card",
}) => {
  const [pendingKey, setPendingKey] = useState<string | undefined>(undefined);
  const [isConfirmingRevokeOthers, setIsConfirmingRevokeOthers] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [clock, setClock] = useState<Date>(() => DateTime.now().toJSDate());

  // Without an injected `now`, tick every minute so relative times don't freeze at first render.
  useEffect(() => {
    if (now) {
      return undefined;
    }
    const interval = setInterval(() => {
      setClock(DateTime.now().toJSDate());
    }, RELATIVE_TIME_REFRESH_MS);
    return (): void => {
      clearInterval(interval);
    };
  }, [now]);

  const effectiveNow = now ?? clock;
  const rows = useMemo(
    () => buildRows({currentSessionId, currentSessionToken, now: effectiveNow, sessions}),
    [currentSessionId, currentSessionToken, effectiveNow, sessions]
  );
  const otherSessionCount = rows.filter((row) => !row.isCurrent).length;
  const isBusy = disabled || pendingKey !== undefined;
  const shownError = error ?? actionError;

  const runAction = useCallback(
    async ({
      key,
      action,
      fallback,
    }: {
      key: string;
      action: () => void | Promise<void>;
      fallback: string;
    }): Promise<void> => {
      setActionError(undefined);
      setPendingKey(key);
      try {
        await action();
      } catch (rejection: unknown) {
        console.warn("SessionsCard: action rejected", rejection);
        setActionError(getRejectionMessage({error: rejection, fallback}));
      } finally {
        setPendingKey(undefined);
      }
    },
    []
  );

  const handleRevoke = useCallback(
    async (row: SessionRow): Promise<void> => {
      if (!onRevoke || isBusy || row.isCurrent) {
        return;
      }
      await runAction({
        action: () => onRevoke(row.session),
        fallback: `Couldn't sign out ${row.label}. Try again.`,
        key: row.session.id,
      });
    },
    [isBusy, onRevoke, runAction]
  );

  const handleOpenRevokeOthers = useCallback((): void => {
    setIsConfirmingRevokeOthers(true);
  }, []);

  const handleDismissConfirm = useCallback((): void => {
    setIsConfirmingRevokeOthers(false);
  }, []);

  const handleConfirmRevokeOthers = useCallback(async (): Promise<void> => {
    setIsConfirmingRevokeOthers(false);
    if (!onRevokeOthers) {
      return;
    }
    await runAction({
      action: onRevokeOthers,
      fallback: "Couldn't sign out your other sessions. Try again.",
      key: REVOKE_OTHERS_KEY,
    });
  }, [onRevokeOthers, runAction]);

  return (
    <Card testID={testID}>
      <Box gap={4}>
        <Box gap={1}>
          <Heading level={2} size="md" testID={`${testID}-title`}>
            {title}
          </Heading>
          <Text color="secondaryLight">{description}</Text>
        </Box>

        {rows.length === 0 && (
          <Text color="secondaryLight" testID={`${testID}-empty`}>
            No active sessions.
          </Text>
        )}

        {rows.map((row) => {
          const {details, iconName, isCurrent, label, lastRefreshed, session, signedIn} = row;
          const {id} = session;
          return (
            <Box
              alignItems="center"
              direction="row"
              gap={3}
              key={id}
              testID={`${testID}-row-${id}`}
            >
              <Box alignItems="center" width={24}>
                <Icon iconName={iconName} size="lg" />
              </Box>
              <Box flex="grow" gap={1}>
                <Box alignItems="center" direction="row" gap={2} wrap>
                  <Text bold testID={`${testID}-name-${id}`}>
                    {label}
                  </Text>
                  {isCurrent && (
                    <Badge
                      secondary
                      status="success"
                      testID={`${testID}-current-${id}`}
                      value="This device"
                    />
                  )}
                </Box>
                {Boolean(details) && (
                  <Text color="secondaryLight" size="sm" testID={`${testID}-details-${id}`}>
                    {details}
                  </Text>
                )}
                {Boolean(signedIn) && (
                  <Text color="secondaryLight" size="sm" testID={`${testID}-signed-in-${id}`}>
                    {`Signed in ${signedIn}`}
                  </Text>
                )}
                {isCurrent && (
                  <Text color="secondaryLight" size="sm" testID={`${testID}-activity-${id}`}>
                    Active now
                  </Text>
                )}
                {!isCurrent && Boolean(lastRefreshed) && (
                  <Text color="secondaryLight" size="sm" testID={`${testID}-activity-${id}`}>
                    {`Last refreshed ${lastRefreshed}`}
                  </Text>
                )}
              </Box>
              {!isCurrent && Boolean(onRevoke) && (
                <Button
                  accessibilityLabel={
                    signedIn ? `Sign out ${label}, signed in ${signedIn}` : `Sign out ${label}`
                  }
                  disabled={isBusy}
                  loading={pendingKey === id}
                  onClick={() => handleRevoke(row)}
                  size="sm"
                  testID={`${testID}-revoke-${id}`}
                  text="Sign out"
                  variant="outline"
                />
              )}
            </Box>
          );
        })}

        {rows.length > 0 && otherSessionCount === 0 && (
          <Text color="secondaryLight" testID={`${testID}-no-others`}>
            You're not signed in anywhere else.
          </Text>
        )}

        {Boolean(shownError) && (
          <View role="alert" testID={`${testID}-error`}>
            <Text color="error">{shownError}</Text>
          </View>
        )}

        {Boolean(onRevokeOthers) && (
          <Box alignItems="start">
            <Button
              disabled={isBusy || otherSessionCount === 0}
              iconName="right-from-bracket"
              loading={pendingKey === REVOKE_OTHERS_KEY}
              onClick={handleOpenRevokeOthers}
              testID={`${testID}-revoke-others`}
              text="Sign out everywhere else"
              variant="secondary"
            />
          </Box>
        )}
      </Box>

      {isConfirmingRevokeOthers && (
        <Modal
          onDismiss={handleDismissConfirm}
          primaryButtonOnClick={handleConfirmRevokeOthers}
          primaryButtonText="Sign out"
          secondaryButtonOnClick={handleDismissConfirm}
          secondaryButtonText="Cancel"
          testIDs={{
            dismiss: `${testID}-confirm-dismiss`,
            primaryButton: `${testID}-confirm-submit`,
            root: `${testID}-confirm`,
            secondaryButton: `${testID}-confirm-cancel`,
            title: `${testID}-confirm-title`,
          }}
          text={`This signs you out on ${otherSessionCount} other ${
            otherSessionCount === 1 ? "session" : "sessions"
          }. You'll stay signed in here.`}
          title="Sign out everywhere else?"
          visible
        />
      )}
    </Card>
  );
};
