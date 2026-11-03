import {selectBetterAuthUser} from "@terreno/rtk";
import {Box, Button, Card, Heading, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import React, {useCallback, useState} from "react";
import {useSelector} from "react-redux";
import {
  CONSENT_ERROR_COPY,
  type ConsentErrorKind,
  consentErrorKind,
  parseConsentScopes,
  readConsentRequestId,
} from "../../components/oauthConsentUtils";
import {
  useApproveMcpOAuthRequestMutation,
  useDenyMcpOAuthRequestMutation,
  useGetMcpOAuthRequestQuery,
} from "../../store/mcpOAuthConsentApi";

type Decision = "approve" | "deny";

const ERROR_TEST_IDS: Record<ConsentErrorKind, string> = {
  decided: "admin-spa-oauth-consent-decided",
  error: "admin-spa-oauth-consent-error",
  expired: "admin-spa-oauth-consent-expired",
  notFound: "admin-spa-oauth-consent-not-found",
  signedOut: "admin-spa-oauth-consent-signed-out",
};

const ConsentFrame: React.FC<{children: React.ReactNode}> = ({children}) => (
  <Box
    alignItems="center"
    color="base"
    flex="grow"
    justifyContent="center"
    padding={6}
    testID="admin-spa-oauth-consent-screen"
  >
    <Box gap={5} maxWidth={480} width="100%">
      {children}
    </Box>
  </Box>
);

const ConsentMessage: React.FC<{message: string; testID: string; title: string}> = ({
  message,
  testID,
  title,
}) => (
  <ConsentFrame>
    <Box gap={3} testID={testID}>
      <Heading size="lg">{title}</Heading>
      <Text color="secondaryDark">{message}</Text>
    </Box>
  </ConsentFrame>
);

/**
 * MCP OAuth consent screen. `@terreno/api` redirects here as `consentUrl?request=<id>` when
 * `mcpOAuth.consentUrl` points at `${issuer}/console/oauth/consent`. Any signed-in user may
 * open it; the session cookie authenticates the read and the decision.
 */
const OAuthConsentScreen: React.FC = () => {
  const {request} = useLocalSearchParams<{request?: string | string[]}>();
  const requestId = readConsentRequestId(request);
  const user = useSelector(selectBetterAuthUser);

  const {
    data: pending,
    error: loadError,
    isLoading,
  } = useGetMcpOAuthRequestQuery(requestId ?? "", {
    refetchOnMountOrArgChange: true,
    skip: !requestId,
  });
  const [approve] = useApproveMcpOAuthRequestMutation();
  const [deny] = useDenyMcpOAuthRequestMutation();

  const [pendingDecision, setPendingDecision] = useState<Decision | undefined>();
  const [decisionError, setDecisionError] = useState<ConsentErrorKind | undefined>();

  const decide = useCallback(
    async (decision: Decision): Promise<void> => {
      if (!requestId || pendingDecision) {
        return;
      }
      setPendingDecision(decision);
      setDecisionError(undefined);
      try {
        const result =
          decision === "approve"
            ? await approve(requestId).unwrap()
            : await deny(requestId).unwrap();
        // Buttons stay disabled: the browser is leaving for the client's redirect URI.
        window.location.assign(result.redirectUrl);
      } catch (error) {
        console.warn(`OAuthConsent: ${decision} failed`, error);
        setDecisionError(consentErrorKind(error));
        setPendingDecision(undefined);
      }
    },
    [approve, deny, pendingDecision, requestId]
  );

  const handleApprove = useCallback(async (): Promise<void> => {
    await decide("approve");
  }, [decide]);

  const handleDeny = useCallback(async (): Promise<void> => {
    await decide("deny");
  }, [decide]);

  if (!requestId) {
    return (
      <ConsentMessage
        message="This page needs a request parameter. Start the connection again from your MCP client."
        testID="admin-spa-oauth-consent-missing-request"
        title="No authorization request"
      />
    );
  }

  if (isLoading) {
    return (
      <ConsentFrame>
        <Box alignItems="center" padding={6} testID="admin-spa-oauth-consent-loading">
          <Spinner />
        </Box>
      </ConsentFrame>
    );
  }

  const errorKind =
    decisionError ?? (loadError || !pending ? consentErrorKind(loadError) : undefined);
  if (errorKind) {
    const copy = CONSENT_ERROR_COPY[errorKind];
    return (
      <ConsentMessage
        message={copy.message}
        testID={ERROR_TEST_IDS[errorKind]}
        title={copy.title}
      />
    );
  }

  if (!pending) {
    return null;
  }

  const clientName = pending.clientName ?? "An unnamed MCP client";
  const scopes = parseConsentScopes(pending.scope);

  return (
    <ConsentFrame>
      <Box gap={2}>
        <Heading size="lg" testID="admin-spa-oauth-consent-client-name">
          {clientName}
        </Heading>
        <Text color="secondaryDark">wants to access your account through MCP.</Text>
      </Box>

      <Card padding={4}>
        <Box gap={2} testID="admin-spa-oauth-consent-redirect-warning">
          <Text>Only approve if you started this from</Text>
          <Text bold size="lg" testID="admin-spa-oauth-consent-redirect-host">
            {pending.redirectHost}
          </Text>
          <Text color="secondaryDark">
            Approving sends an authorization code there. If you did not just connect an app on that
            site, deny this request.
          </Text>
        </Box>
      </Card>

      <Box gap={1} testID="admin-spa-oauth-consent-scope">
        <Text bold>Requested access</Text>
        {scopes.length > 0 ? (
          scopes.map((scope) => (
            <Text key={scope} testID={`admin-spa-oauth-consent-scope-${scope}`}>
              {scope}
            </Text>
          ))
        ) : (
          <Text color="secondaryDark">The server's default MCP access</Text>
        )}
      </Box>

      {/* Text links an email into nested spans that inherit its testID, so the id sits on a Box. */}
      <Box testID="admin-spa-oauth-consent-user-email">
        <Text color="secondaryDark">Signed in as {user?.email ?? "your account"}</Text>
      </Box>

      <Box direction="row" gap={3}>
        <Box flex="grow">
          <Button
            disabled={Boolean(pendingDecision)}
            fullWidth
            loading={pendingDecision === "deny"}
            onClick={handleDeny}
            testID="admin-spa-oauth-consent-deny-button"
            text="Deny"
            variant="secondary"
          />
        </Box>
        <Box flex="grow">
          <Button
            disabled={Boolean(pendingDecision)}
            fullWidth
            loading={pendingDecision === "approve"}
            onClick={handleApprove}
            testID="admin-spa-oauth-consent-approve-button"
            text="Approve"
            variant="primary"
          />
        </Box>
      </Box>
    </ConsentFrame>
  );
};

export default OAuthConsentScreen;
