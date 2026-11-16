/**
 * A drop-in MCP OAuth consent route: `TerrenoLoginScreen` inline while signed out, then the
 * consent card for the pending authorization request, driven by `useMcpOAuthConsent`.
 */
import {Box, Button, Card, CheckBox, Heading, Spinner, Text} from "@terreno/ui";
import {type FC, type ReactNode, useCallback} from "react";
import {Pressable} from "react-native";

import {IsWeb} from "./platform";
import {useSession} from "./SessionProvider";
import {TerrenoLoginScreen, type TerrenoLoginScreenProps} from "./TerrenoLoginScreen";
import {
  type McpOAuthConsentErrorKind,
  type McpOAuthConsentGrant,
  useMcpOAuthConsent,
} from "./useMcpOAuthConsent";

/** Title and message the consent screen shows for each error kind. */
export const MCP_OAUTH_CONSENT_ERROR_COPY: Readonly<
  Record<McpOAuthConsentErrorKind, {title: string; message: string}>
> = {
  decided: {
    message:
      "This request was already approved or denied. Start the connection again from your app.",
    title: "Request already decided",
  },
  expired: {
    message: "Authorization requests expire after a few minutes. Start the connection again.",
    title: "Request expired",
  },
  missingRequest: {
    message: "This link has no authorization request. Start the connection again from your app.",
    title: "Missing authorization request",
  },
  notFound: {
    message: "This authorization request does not exist. Check the link or start again.",
    title: "Request not found",
  },
  signedOut: {
    message: "Your session ended, or this browser cannot decide this request. Sign in again.",
    title: "Sign in required",
  },
  unknown: {
    message: "Something went wrong loading or deciding this request. Try again.",
    title: "Could not complete the request",
  },
};

const UNNAMED_CLIENT = "An unnamed MCP client";

/** Label and description that replace the server's copy for one grant scope. */
export interface McpOAuthConsentGrantLabel {
  label: string;
  description?: string;
}

export interface TerrenoOAuthConsentScreenProps {
  /**
   * The pending authorization request id. Defaults to the `request` query parameter of the
   * current web URL.
   */
  requestId?: string;
  /**
   * Everything `TerrenoLoginScreen` needs while signed out (`client`, `rememberedAccounts`,
   * `methods`, `title`, `logo`, `providerLabels`, ...). The screen supplies `onSignedIn`, which
   * refreshes the session so the consent card renders in place. `callbackURL` defaults to the
   * current web URL, so social sign-in returns here with `?request=` intact.
   */
  loginProps: Omit<TerrenoLoginScreenProps, "onSignedIn">;
  /** Heading above the consent card. */
  title?: string;
  /** Logo shown above the consent card. */
  logo?: ReactNode;
  /** Overrides the server's label and description per grant scope. */
  grantLabels?: Record<string, McpOAuthConsentGrantLabel>;
  /**
   * Follows the URL the server returns after approve or deny. Defaults to
   * `window.location.assign` on web and `Linking.openURL` on native.
   */
  onRedirect?: (url: string) => void;
  /**
   * Prefix for every test id: `-screen`, `-client-name`, `-grant-${scope}`, `-approve-button`,
   * `-deny-button`, `-error`, `-signed-in-as`.
   * @default "oauth-consent"
   */
  testID?: string;
}

const readWebRequestId = (): string | undefined => {
  if (!IsWeb || typeof window === "undefined") {
    return undefined;
  }
  const search = window.location?.search ?? "";
  return new URLSearchParams(search).get("request") ?? undefined;
};

const readWebHref = (): string | undefined => {
  if (!IsWeb || typeof window === "undefined") {
    return undefined;
  }
  return window.location?.href;
};

const ConsentFrame: FC<{children: ReactNode; testID: string}> = ({children, testID}) => (
  <Box
    alignItems="center"
    color="base"
    flex="grow"
    justifyContent="center"
    padding={6}
    testID={`${testID}-screen`}
  >
    <Box gap={5} maxWidth={480} width="100%">
      {children}
    </Box>
  </Box>
);

interface GrantRowProps {
  grant: McpOAuthConsentGrant;
  override?: McpOAuthConsentGrantLabel;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: (scope: string) => void;
  testID: string;
}

const GrantRow: FC<GrantRowProps> = ({
  grant,
  override,
  isSelected,
  isDisabled,
  onToggle,
  testID,
}) => {
  const label = override?.label ?? grant.label;
  const description = override ? override.description : (grant.description ?? undefined);

  const handleClick = useCallback((): void => {
    if (isDisabled) {
      return;
    }
    onToggle(grant.scope);
  }, [grant.scope, isDisabled, onToggle]);

  // A react-native Pressable, not a clickable Box: Box renames its pressable to `${testID}-clickable`,
  // and the checkbox element itself must carry the documented `${testID}-grant-${scope}` id.
  return (
    <Pressable
      accessibilityHint={isSelected ? "Removes this access" : "Grants this access"}
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{checked: isSelected, disabled: isDisabled}}
      aria-checked={isSelected}
      disabled={isDisabled}
      onPress={handleClick}
      testID={`${testID}-grant-${grant.scope}`}
    >
      <Box alignItems="start" direction="row" gap={3}>
        <CheckBox selected={isSelected} />
        <Box flex="shrink" gap={1}>
          <Text bold>{label}</Text>
          {description ? <Text color="secondaryDark">{description}</Text> : null}
        </Box>
      </Box>
    </Pressable>
  );
};

interface ConsentCardProps {
  requestId: string | undefined;
  title?: string;
  logo?: ReactNode;
  grantLabels?: Record<string, McpOAuthConsentGrantLabel>;
  onRedirect?: (url: string) => void;
  email: string | undefined;
  testID: string;
}

const ConsentCard: FC<ConsentCardProps> = ({
  requestId,
  title,
  logo,
  grantLabels,
  onRedirect,
  email,
  testID,
}) => {
  const consent = useMcpOAuthConsent({onRedirect, requestId});
  const {approve, deny, request, selectedScopes, state, toggleScope} = consent;

  const handleApprove = useCallback(async (): Promise<void> => {
    await approve();
  }, [approve]);

  const handleDeny = useCallback(async (): Promise<void> => {
    await deny();
  }, [deny]);

  if (state === "error") {
    const copy = MCP_OAUTH_CONSENT_ERROR_COPY[consent.errorKind ?? "unknown"];
    return (
      <ConsentFrame testID={testID}>
        {logo}
        <Box gap={3} testID={`${testID}-error`}>
          <Heading size="lg">{copy.title}</Heading>
          <Text color="secondaryDark">{copy.message}</Text>
        </Box>
      </ConsentFrame>
    );
  }

  if (!request) {
    return (
      <ConsentFrame testID={testID}>
        <Box alignItems="center" padding={6} testID={`${testID}-loading`}>
          <Spinner />
        </Box>
      </ConsentFrame>
    );
  }

  const isSubmitting = state === "submitting";

  return (
    <ConsentFrame testID={testID}>
      {logo}
      {title ? <Heading size="md">{title}</Heading> : null}
      <Box gap={2}>
        <Heading size="lg" testID={`${testID}-client-name`}>
          {request.clientName ?? UNNAMED_CLIENT}
        </Heading>
        <Text color="secondaryDark">wants to access your account through MCP.</Text>
      </Box>

      <Card padding={4}>
        <Box gap={2} testID={`${testID}-redirect-warning`}>
          <Text>Only approve if you started this from</Text>
          <Text bold size="lg" testID={`${testID}-redirect-host`}>
            {request.redirectHost}
          </Text>
          <Text color="secondaryDark">
            Approving sends an authorization code there. If you did not just connect an app on that
            site, deny this request.
          </Text>
        </Box>
      </Card>

      <Box gap={3} testID={`${testID}-grants`}>
        <Text bold>Requested access</Text>
        {request.grants.length > 0 ? (
          request.grants.map((grant) => (
            <GrantRow
              grant={grant}
              isDisabled={isSubmitting}
              isSelected={selectedScopes.includes(grant.scope)}
              key={grant.scope}
              onToggle={toggleScope}
              override={grantLabels?.[grant.scope]}
              testID={testID}
            />
          ))
        ) : (
          <Text color="secondaryDark">The server's default MCP access</Text>
        )}
      </Box>

      {/* Text links an email into nested spans that inherit its testID, so the id sits on a Box. */}
      <Box testID={`${testID}-signed-in-as`}>
        <Text color="secondaryDark">Signed in as {email ?? "your account"}</Text>
      </Box>

      <Box direction="row" gap={3}>
        <Box flex="grow">
          <Button
            disabled={isSubmitting}
            fullWidth
            onClick={handleDeny}
            testID={`${testID}-deny-button`}
            text="Deny"
            variant="secondary"
          />
        </Box>
        <Box flex="grow">
          <Button
            disabled={isSubmitting || selectedScopes.length === 0}
            fullWidth
            loading={isSubmitting}
            onClick={handleApprove}
            testID={`${testID}-approve-button`}
            text="Approve"
            variant="primary"
          />
        </Box>
      </Box>
    </ConsentFrame>
  );
};

/**
 * One screen for the whole MCP OAuth consent route. Signed out, it shows `TerrenoLoginScreen`
 * with `loginProps`; signing in refreshes the session and the consent card replaces it without
 * navigation. Signed in, it shows the client, the redirect host, a checkbox per requested grant
 * (all checked; the user may narrow them), the signed-in email, and Approve and Deny. Must render
 * inside `SessionProvider` and an `ApiClientProvider` whose client sends the user's credentials.
 *
 * @example
 * ```tsx
 * <TerrenoOAuthConsentScreen
 *   loginProps={{
 *     client: authClient,
 *     methods: {providers: ["google"]},
 *     rememberedAccounts,
 *     title: "Sign in to connect",
 *   }}
 * />
 * ```
 */
export const TerrenoOAuthConsentScreen: FC<TerrenoOAuthConsentScreenProps> = ({
  requestId,
  loginProps,
  title,
  logo,
  grantLabels,
  onRedirect,
  testID = "oauth-consent",
}) => {
  const {isLoading, refresh, user, userId} = useSession();

  const handleSignedIn = useCallback(async (): Promise<void> => {
    await refresh();
  }, [refresh]);

  if (isLoading) {
    return (
      <ConsentFrame testID={testID}>
        <Box alignItems="center" padding={6} testID={`${testID}-loading`}>
          <Spinner />
        </Box>
      </ConsentFrame>
    );
  }

  if (!userId) {
    return (
      <TerrenoLoginScreen
        {...loginProps}
        callbackURL={loginProps.callbackURL ?? readWebHref()}
        onSignedIn={handleSignedIn}
      />
    );
  }

  return (
    <ConsentCard
      email={user?.email ?? undefined}
      grantLabels={grantLabels}
      logo={logo}
      onRedirect={onRedirect}
      requestId={requestId ?? readWebRequestId()}
      testID={testID}
      title={title}
    />
  );
};
