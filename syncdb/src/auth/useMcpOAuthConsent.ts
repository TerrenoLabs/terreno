/**
 * Drives the MCP OAuth consent screen: loads a pending authorization request, tracks which of its
 * grants the user keeps selected, and approves or denies it through the app's request client
 * (`ApiClientProvider`). The server answers each decision with the URL that hands the result back
 * to the MCP client, which `onRedirect` follows.
 */
import {useCallback, useEffect, useRef, useState} from "react";
import {Linking} from "react-native";

import {isApiError} from "../api/apiError";
import {useApiClient} from "../react/apiHooks";
import {IsWeb} from "./platform";

/** Access level a grant gives. Write implies read. */
export type McpOAuthConsentGrantAccess = "read" | "write";

/** One grant the MCP client asked for, as the consent screen shows it. */
export interface McpOAuthConsentGrant {
  /** OAuth scope value the grant stands for. */
  scope: string;
  /** Short name shown next to the grant's checkbox. */
  label: string;
  /** Longer explanation shown under the label, or `null` when the app gave none. */
  description: string | null;
  access: McpOAuthConsentGrantAccess;
}

/** A pending authorization request, as returned by `GET /oauth/authorize/:request`. */
export interface McpOAuthConsentRequest {
  requestId: string;
  clientId: string;
  /** Name the client registered with, or `null` when it gave none. */
  clientName: string | null;
  /** Host the authorization code is sent to, so the user can tell where access goes. */
  redirectHost: string;
  redirectUri: string;
  /** Requested scopes the server knows, in the order the app configured them. */
  grants: McpOAuthConsentGrant[];
  /** The raw requested scope string, or `null` when the client asked for none. */
  scope: string | null;
  resource: string;
  expiresAt: string;
}

/**
 * Why consent cannot continue: no `request` in the URL (`missingRequest`), no such request
 * (`notFound`, 404), already approved or denied (`decided`, 409), expired (`expired`, 400),
 * not signed in (`signedOut`, 401), or anything else (`unknown`).
 */
export type McpOAuthConsentErrorKind =
  | "missingRequest"
  | "notFound"
  | "decided"
  | "expired"
  | "signedOut"
  | "unknown";

export type McpOAuthConsentState = "loading" | "ready" | "submitting" | "error";

export interface UseMcpOAuthConsentOptions {
  /** The `request` query parameter from the consent URL. */
  requestId: string | undefined;
  /**
   * Follows the URL the server returns after approve or deny. Defaults to
   * `window.location.assign` on web and `Linking.openURL` on native.
   */
  onRedirect?: (url: string) => void;
}

export interface UseMcpOAuthConsentResult {
  state: McpOAuthConsentState;
  /** The loaded request; present once `state` has been `ready`. */
  request?: McpOAuthConsentRequest;
  /** Scopes the user keeps selected, in grant order. Every grant starts selected. */
  selectedScopes: string[];
  /** Selects or clears one grant's scope. */
  toggleScope: (scope: string) => void;
  /** Approves the selected scopes and redirects. Does nothing when none is selected. */
  approve: () => Promise<void>;
  /** Denies the request and redirects. */
  deny: () => Promise<void>;
  /** Set when `state` is `error`. */
  errorKind?: McpOAuthConsentErrorKind;
}

interface ConsentDecision {
  redirectUrl: string;
}

interface ConsentSnapshot {
  requestId: string | undefined;
  state: McpOAuthConsentState;
  request?: McpOAuthConsentRequest;
  selectedScopes: string[];
  errorKind?: McpOAuthConsentErrorKind;
}

const ERROR_KIND_BY_STATUS: Readonly<Record<number, McpOAuthConsentErrorKind>> = {
  400: "expired",
  401: "signedOut",
  404: "notFound",
  409: "decided",
};

const toErrorKind = (error: unknown): McpOAuthConsentErrorKind => {
  if (!isApiError(error)) {
    return "unknown";
  }
  return ERROR_KIND_BY_STATUS[error.status] ?? "unknown";
};

const defaultRedirect = (url: string): void => {
  if (IsWeb) {
    window.location.assign(url);
    return;
  }
  Linking.openURL(url).catch((error: unknown) => {
    console.warn("[useMcpOAuthConsent] Could not open the MCP OAuth redirect", error);
  });
};

const requestPath = (requestId: string): string =>
  `/oauth/authorize/${encodeURIComponent(requestId)}`;

const initialSnapshot = (requestId: string | undefined): ConsentSnapshot =>
  requestId
    ? {requestId, selectedScopes: [], state: "loading"}
    : {errorKind: "missingRequest", requestId, selectedScopes: [], state: "error"};

/**
 * Loads the MCP OAuth consent request `requestId` and approves or denies it. Must render inside an
 * `ApiClientProvider` whose client sends the signed-in user's credentials.
 */
export const useMcpOAuthConsent = ({
  requestId,
  onRedirect,
}: UseMcpOAuthConsentOptions): UseMcpOAuthConsentResult => {
  const client = useApiClient();
  const [snapshot, setSnapshot] = useState<ConsentSnapshot>(() => initialSnapshot(requestId));
  // Guards against a second decision before the `submitting` render lands (double clicks).
  const isDecidingRef = useRef(false);

  // Reset when the consent URL names a different request, so stale grants never show.
  const current = snapshot.requestId === requestId ? snapshot : initialSnapshot(requestId);
  if (current !== snapshot) {
    setSnapshot(current);
  }

  // Load the pending request whenever the consent URL names one.
  useEffect(() => {
    if (!requestId) {
      return;
    }
    let isCancelled = false;
    client.request<McpOAuthConsentRequest>({url: requestPath(requestId)}).then(
      (request) => {
        if (isCancelled) {
          return;
        }
        setSnapshot({
          request,
          requestId,
          selectedScopes: request.grants.map((grant) => grant.scope),
          state: "ready",
        });
      },
      (error: unknown) => {
        if (isCancelled) {
          return;
        }
        setSnapshot({errorKind: toErrorKind(error), requestId, selectedScopes: [], state: "error"});
      }
    );
    return (): void => {
      isCancelled = true;
    };
  }, [client, requestId]);

  const toggleScope = useCallback((scope: string): void => {
    setSnapshot((previous) => {
      if (!previous.request) {
        return previous;
      }
      const isSelected = previous.selectedScopes.includes(scope);
      const selectedScopes = previous.request.grants
        .map((grant) => grant.scope)
        .filter((grantScope) =>
          grantScope === scope ? !isSelected : previous.selectedScopes.includes(grantScope)
        );
      return {...previous, selectedScopes};
    });
  }, []);

  const decide = useCallback(
    async (decision: "approve" | "deny", body?: Record<string, unknown>): Promise<void> => {
      if (!requestId || isDecidingRef.current) {
        return;
      }
      isDecidingRef.current = true;
      setSnapshot((previous) => ({...previous, state: "submitting"}));
      let result: ConsentDecision;
      try {
        result = await client.request<ConsentDecision>({
          body,
          method: "POST",
          url: `${requestPath(requestId)}/${decision}`,
        });
      } catch (error: unknown) {
        isDecidingRef.current = false;
        setSnapshot((previous) => ({...previous, errorKind: toErrorKind(error), state: "error"}));
        return;
      }
      // Stay in `submitting` while the browser leaves, so the buttons cannot submit twice.
      (onRedirect ?? defaultRedirect)(result.redirectUrl);
    },
    [client, onRedirect, requestId]
  );

  const approve = useCallback(async (): Promise<void> => {
    if (current.state !== "ready" || current.selectedScopes.length === 0) {
      return;
    }
    await decide("approve", {scope: current.selectedScopes.join(" ")});
  }, [current.selectedScopes, current.state, decide]);

  const deny = useCallback(async (): Promise<void> => {
    if (current.state !== "ready") {
      return;
    }
    await decide("deny");
  }, [current.state, decide]);

  return {
    approve,
    deny,
    errorKind: current.errorKind,
    request: current.request,
    selectedScopes: current.selectedScopes,
    state: current.state,
    toggleScope,
  };
};
