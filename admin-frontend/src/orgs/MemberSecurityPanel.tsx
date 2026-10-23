import {Badge, Box, Button, Card, Heading, Modal, Spinner, Text, Unifier} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {AccessibilityInfo, findNodeHandle, Platform, View} from "react-native";
import {
  type MemberSecurityAction,
  type MemberSecurityActionResult,
  securityActionParams,
  useMemberSecurityApi,
} from "./useMemberSecurityApi";

export interface MemberSecurityPanelProps {
  /** Route prefix: defaults to `/orgs` with `orgId`, `/users` without. */
  baseURL?: string;
  /**
   * Move keyboard and screen-reader focus to the panel heading when it mounts, so opening the
   * panel from a list lands the user on it. Defaults to true.
   */
  focusOnMount?: boolean;
  /** Who the panel is about, shown in the heading (name or email). */
  memberLabel?: string;
  /** Called after every successful action, such as to refresh a member list. */
  onActionComplete?: (result: MemberSecurityActionResult) => void;
  /** Shows a Close button when set. */
  onClose?: () => void;
  /** Organization id for the org-admin routes. Omit for the platform `/users/:id/security` routes. */
  orgId?: string;
  testID?: string;
  userId: string;
}

interface PendingAction {
  action: MemberSecurityAction;
  params?: Record<string, string>;
  /** What the action is about, such as a passkey name or a provider label. */
  subject?: string;
}

interface ActionOutcome {
  expiresAt?: string;
  message: string;
  url?: string;
}

interface ActionCopy {
  confirm?: (subject?: string) => string;
  /** The member is out of the routes' reach afterwards, so the summary is not refetched. */
  endsReach?: boolean;
  /** Accessible name for a per-item button, such as `Unlink GitHub`. */
  itemLabel?: (subject: string) => string;
  success: (result: MemberSecurityActionResult, subject?: string) => string;
}

const RESET_SENT = " A password reset email was sent because it was their last way to sign in.";

/** Action-specific copy. Actions not listed here get the generic copy. */
const ACTION_COPY: Record<string, ActionCopy> = {
  disable: {
    confirm: () => "The account is disabled and signed out on every device.",
    success: () => "Account disabled",
  },
  enable: {success: () => "Account enabled"},
  "issue-sign-in-link": {success: () => "Sign-in link issued"},
  "remove-passkey": {
    confirm: (subject) =>
      `Remove the passkey "${subject ?? "Unnamed passkey"}"? If it is their last way to sign in, a password reset email is sent first.`,
    itemLabel: (subject) => `Remove passkey ${subject}`,
    success: (result) => `Passkey removed.${result.passwordResetSent === true ? RESET_SENT : ""}`,
  },
  "reset-two-factor": {
    confirm: () =>
      "Their authenticator and backup codes are removed and trusted devices are forgotten. Their next sign-in won't ask for a code, and they can enroll again from their own security screen.",
    success: (result) => (result.changed ? "Two-factor reset" : "Two-factor was already off"),
  },
  "revoke-sessions": {
    confirm: () => "Sign them out on every device? They need to sign in again everywhere.",
    success: (result) => {
      const count = typeof result.revokedCount === "number" ? result.revokedCount : 0;
      return `Signed out of ${count} ${count === 1 ? "session" : "sessions"}`;
    },
  },
  "send-password-reset": {success: () => "Password reset email sent"},
  "suspend-membership": {
    confirm: () =>
      "Suspend their membership in this organization? Their account and their other organizations are not affected.",
    endsReach: true,
    success: (result) =>
      result.changed
        ? "Membership suspended. Reactivate it from the members list."
        : "Membership was already suspended",
  },
  "unlink-provider": {
    confirm: (subject) =>
      `Unlink ${subject ?? "this provider"}? Sessions they started with ${subject ?? "it"} are not ended. If the account may be compromised, use Sign out everywhere after unlinking.`,
    itemLabel: (subject) => `Unlink ${subject}`,
    success: (result, subject) =>
      `${subject ?? "Provider"} unlinked.${result.passwordResetSent === true ? RESET_SENT : " Sessions started with it are still active; use Sign out everywhere to end them."}`,
  },
};

const genericConfirm = (action: MemberSecurityAction): string =>
  `Run "${action.label}" on this account? This changes how they sign in.`;

const genericSuccess = (
  action: MemberSecurityAction,
  result: MemberSecurityActionResult
): string => (result.changed ? `${action.label}: done` : `${action.label}: nothing to change`);

/** Parameterless actions rendered beside the part of the summary they change. */
const SECTION_ACTION_IDS = new Set(["reset-two-factor", "revoke-sessions"]);

/**
 * Whether the action's path takes exactly this one param. Actions taking `:passkeyId` render on
 * each passkey and `:providerId` on each provider; any other param cannot be filled from the
 * summary, so that action is not offered.
 */
const takesOnly = (action: MemberSecurityAction, param: string): boolean => {
  const params = securityActionParams(action);
  return params.length === 1 && params[0] === param;
};

const PROVIDER_LABELS: Record<string, string> = {
  apple: "Apple",
  github: "GitHub",
  google: "Google",
  "mock-oidc": "Mock OIDC",
};

const providerLabel = (providerId: string): string => PROVIDER_LABELS[providerId] ?? providerId;

const formatTime = (iso: string | null): string | undefined => {
  if (!iso) {
    return undefined;
  }
  const parsed = DateTime.fromISO(iso);
  return parsed.isValid ? parsed.toLocaleString(DateTime.DATETIME_MED) : undefined;
};

const errorTitle = (error: unknown, fallback: string): string => {
  if (typeof error !== "object" || error === null) {
    return fallback;
  }
  const title = (error as {data?: {title?: unknown}}).data?.title;
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  const message = (error as {message?: unknown}).message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
};

const Alert: React.FC<{message: string; testID: string}> = ({message, testID}) => (
  <View role="alert" testID={testID}>
    <Text color="error">{message}</Text>
  </View>
);

/**
 * A user's sign-in security summary with the recovery actions the server offers. Actions render
 * from the summary's `actions`, so new server actions appear without frontend changes;
 * destructive ones confirm first. Works against the org-admin routes (`orgId`) or the platform
 * `/users/:id/security` routes.
 */
export const MemberSecurityPanel: React.FC<MemberSecurityPanelProps> = ({
  baseURL,
  memberLabel,
  onActionComplete,
  onClose,
  focusOnMount = true,
  orgId,
  testID = "member-security-panel",
  userId,
}) => {
  const headingRef = useRef<View>(null);
  const {error, isLoading, isRunning, refetch, runAction, summary} = useMemberSecurityApi({
    baseURL,
    orgId,
    userId,
  });
  const [pending, setPending] = useState<PendingAction>();
  const [outcome, setOutcome] = useState<ActionOutcome>();
  const [actionError, setActionError] = useState<string>();
  const [isOutOfReach, setIsOutOfReach] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Land keyboard and screen-reader users on the panel when it opens below a list.
  useEffect(() => {
    const heading = headingRef.current;
    if (!focusOnMount || !heading) {
      return;
    }
    if (Platform.OS === "web") {
      const element = heading as unknown as {
        focus?: () => void;
        scrollIntoView?: (options: {block: string}) => void;
      };
      element.scrollIntoView?.({block: "nearest"});
      element.focus?.();
      return;
    }
    const handle = findNodeHandle(heading);
    if (handle) {
      AccessibilityInfo.setAccessibilityFocus(handle);
    }
  }, [focusOnMount]);

  const execute = useCallback(
    async ({action, params, subject}: PendingAction): Promise<void> => {
      setPending(undefined);
      setActionError(undefined);
      setOutcome(undefined);
      setIsCopied(false);
      try {
        const result = await runAction({action, params});
        const copy = ACTION_COPY[action.id];
        setOutcome({
          expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : undefined,
          message: copy ? copy.success(result, subject) : genericSuccess(action, result),
          url: typeof result.url === "string" ? result.url : undefined,
        });
        if (copy?.endsReach && result.changed) {
          setIsOutOfReach(true);
        } else {
          refetch();
        }
        onActionComplete?.(result);
      } catch (caught) {
        setActionError(errorTitle(caught, `${action.label} failed`));
      }
    },
    [onActionComplete, refetch, runAction]
  );

  const request = useCallback(
    (next: PendingAction): void => {
      if (next.action.destructive) {
        setPending(next);
        return;
      }
      void execute(next);
    },
    [execute]
  );

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (pending) {
      await execute(pending);
    }
  }, [execute, pending]);

  const handleCancel = useCallback((): void => {
    setPending(undefined);
  }, []);

  const handleCopy = useCallback((): void => {
    if (outcome?.url) {
      Unifier.utils.copyToClipboard(outcome.url);
      setIsCopied(true);
    }
  }, [outcome?.url]);

  const findAction = (id: string): MemberSecurityAction | undefined =>
    summary?.actions.find((action) => action.id === id);

  const renderActionButton = ({
    action,
    params,
    subject,
    suffix,
  }: {
    action: MemberSecurityAction;
    params?: Record<string, string>;
    subject?: string;
    suffix?: string;
  }): React.ReactElement => (
    <Button
      accessibilityLabel={
        subject
          ? (ACTION_COPY[action.id]?.itemLabel?.(subject) ?? `${action.label}: ${subject}`)
          : action.label
      }
      disabled={isRunning}
      key={`${action.id}-${suffix ?? ""}`}
      onClick={() => request({action, params, subject})}
      size="sm"
      testID={`${testID}-action-${action.id}${suffix ? `-${suffix}` : ""}`}
      text={action.label}
      variant={action.destructive ? "destructive" : "outline"}
    />
  );

  const header = (
    <Box alignItems="center" direction="row" justifyContent="between">
      <View ref={headingRef} tabIndex={-1} testID={`${testID}-heading`}>
        <Heading size="sm">{memberLabel ? `Security: ${memberLabel}` : "Security"}</Heading>
      </View>
      {onClose ? (
        <Button
          onClick={onClose}
          size="sm"
          testID={`${testID}-close`}
          text="Close"
          variant="ghost"
        />
      ) : null}
    </Box>
  );

  const feedback = (
    <>
      {actionError ? <Alert message={actionError} testID={`${testID}-action-error`} /> : null}
      {outcome ? (
        <Box gap={2}>
          <View role="status" testID={`${testID}-result`}>
            <Text color="success">{outcome.message}</Text>
          </View>
          {outcome.url ? (
            <Box border="default" gap={2} padding={3} rounding="md">
              <Text testID={`${testID}-link`}>{outcome.url}</Text>
              <Text color="secondaryDark" size="sm">
                {`This link works once${outcome.expiresAt ? ` and expires ${formatTime(outcome.expiresAt) ?? outcome.expiresAt}` : ""}. Copy it now: it is not shown again.`}
              </Text>
              <Box direction="row">
                <Button
                  iconName="copy"
                  onClick={handleCopy}
                  size="sm"
                  testID={`${testID}-link-copy`}
                  text={isCopied ? "Copied" : "Copy link"}
                  variant="outline"
                />
              </Box>
              <View role="status" testID={`${testID}-link-copied`}>
                {isCopied ? (
                  <Text color="secondaryDark" size="sm">
                    Link copied to the clipboard
                  </Text>
                ) : null}
              </View>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </>
  );

  if (isOutOfReach) {
    return (
      <Card gap={3} padding={4} testID={testID}>
        {header}
        {feedback}
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card gap={3} padding={4} testID={testID}>
        {header}
        {isLoading ? (
          <Box alignItems="center" padding={4} testID={`${testID}-loading`}>
            <Spinner />
          </Box>
        ) : (
          <Alert
            message={errorTitle(error, "Could not load security details.")}
            testID={`${testID}-error`}
          />
        )}
        {feedback}
      </Card>
    );
  }

  const providerActions = summary.actions.filter((action) => takesOnly(action, "providerId"));
  const passkeyActions = summary.actions.filter((action) => takesOnly(action, "passkeyId"));
  const resetTwoFactorAction = findAction("reset-two-factor");
  const revokeSessionsAction = findAction("revoke-sessions");
  const listedActions = summary.actions.filter(
    (action) => !SECTION_ACTION_IDS.has(action.id) && securityActionParams(action).length === 0
  );
  const lastSignInTime = formatTime(summary.lastSignIn.at);

  return (
    <Card gap={4} padding={4} testID={testID}>
      {header}
      {error ? (
        <Alert
          message={errorTitle(error, "Could not refresh security details.")}
          testID={`${testID}-refresh-error`}
        />
      ) : null}
      <Box direction="row" gap={2} wrap>
        {summary.disabled ? (
          <Badge status="error" testID={`${testID}-disabled`} value="Disabled" />
        ) : null}
        <Badge
          status={summary.emailVerified ? "success" : "warning"}
          testID={`${testID}-email-verified`}
          value={summary.emailVerified ? "Email verified" : "Email not verified"}
        />
      </Box>
      <Text color="secondaryDark" testID={`${testID}-last-sign-in`}>
        {summary.lastSignIn.method || lastSignInTime
          ? `Last sign-in: ${summary.lastSignIn.method ?? "unknown method"}${lastSignInTime ? `, ${lastSignInTime}` : ""}`
          : "No sign-in recorded"}
      </Text>

      <Box gap={2} testID={`${testID}-methods`}>
        <Text bold>Sign-in methods</Text>
        <Text testID={`${testID}-password`}>
          {summary.password ? "Password: set" : "Password: not set"}
        </Text>
        {summary.providers.length === 0 ? (
          <Text color="secondaryDark">No linked providers</Text>
        ) : (
          summary.providers.map((provider) => (
            <Box
              alignItems="center"
              direction="row"
              gap={2}
              key={provider.providerId}
              testID={`${testID}-provider-${provider.providerId}`}
            >
              <Text>{providerLabel(provider.providerId)}</Text>
              {providerActions.map((action) =>
                renderActionButton({
                  action,
                  params: {providerId: provider.providerId},
                  subject: providerLabel(provider.providerId),
                  suffix: provider.providerId,
                })
              )}
            </Box>
          ))
        )}
      </Box>

      <Box gap={2} testID={`${testID}-passkeys`}>
        <Text bold>{`Passkeys (${summary.passkeys.count})`}</Text>
        {summary.passkeys.items.length === 0 ? (
          <Text color="secondaryDark">No passkeys</Text>
        ) : (
          summary.passkeys.items.map((passkey) => (
            <Box
              alignItems="center"
              direction="row"
              gap={2}
              key={passkey.id}
              testID={`${testID}-passkey-${passkey.id}`}
            >
              <Text>
                {`${passkey.name ?? "Unnamed passkey"}${formatTime(passkey.createdAt) ? `, added ${formatTime(passkey.createdAt)}` : ""}`}
              </Text>
              {passkeyActions.map((action) =>
                renderActionButton({
                  action,
                  params: {passkeyId: passkey.id},
                  subject: passkey.name ?? "Unnamed passkey",
                  suffix: passkey.id,
                })
              )}
            </Box>
          ))
        )}
      </Box>

      <Box gap={2}>
        <Text bold>Two-factor</Text>
        <Box alignItems="center" direction="row" gap={2}>
          <Text testID={`${testID}-two-factor-status`}>
            {summary.twoFactor.enabled
              ? `On${summary.twoFactor.backupCodesRemaining === null ? "" : `, ${summary.twoFactor.backupCodesRemaining} backup codes left`}`
              : "Off"}
          </Text>
          {resetTwoFactorAction ? renderActionButton({action: resetTwoFactorAction}) : null}
        </Box>
      </Box>

      <Box gap={2}>
        <Text bold>Sessions</Text>
        <Box alignItems="center" direction="row" gap={2}>
          <Text testID={`${testID}-sessions`}>{`${summary.sessions.active} active`}</Text>
          {revokeSessionsAction ? renderActionButton({action: revokeSessionsAction}) : null}
        </Box>
      </Box>

      {listedActions.length > 0 ? (
        <Box gap={2}>
          <Text bold>Actions</Text>
          <Box direction="row" gap={2} wrap>
            {listedActions.map((action) => renderActionButton({action}))}
          </Box>
        </Box>
      ) : null}

      {feedback}

      <Modal
        onDismiss={handleCancel}
        primaryButtonDisabled={isRunning}
        primaryButtonOnClick={handleConfirm}
        primaryButtonText={pending?.action.label ?? "Confirm"}
        secondaryButtonOnClick={handleCancel}
        secondaryButtonText="Cancel"
        testID={`${testID}-confirm`}
        text={
          pending
            ? (ACTION_COPY[pending.action.id]?.confirm?.(pending.subject) ??
              genericConfirm(pending.action))
            : undefined
        }
        title={pending ? `${pending.action.label}?` : undefined}
        visible={Boolean(pending)}
      />
    </Card>
  );
};
