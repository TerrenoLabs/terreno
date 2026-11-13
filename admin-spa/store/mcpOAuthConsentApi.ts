import {useApiMutation, useApiQuery} from "@terreno/syncdb/react";

/** What `GET /oauth/authorize/:request` returns (the `{data}` envelope is unwrapped). */
interface McpOAuthRequest {
  clientId: string;
  clientName: string | null;
  expiresAt: string;
  redirectHost: string;
  redirectUri: string;
  requestId: string;
  resource?: string;
  scope: string | null;
}

/** What approve and deny return: where to send the browser next. */
interface McpOAuthDecision {
  redirectUrl: string;
}

const requestUrl = (requestId: string): string =>
  `/oauth/authorize/${encodeURIComponent(requestId)}`;

/**
 * MCP OAuth consent endpoints from `@terreno/api`. They ride the SPA's same-origin request
 * client, so the Better Auth session cookie authenticates them with no bearer.
 */
export const useGetMcpOAuthRequestQuery = (requestId: string | undefined) =>
  useApiQuery<McpOAuthRequest>(requestId ? {method: "GET", url: requestUrl(requestId)} : null);

export const useApproveMcpOAuthRequestMutation = () =>
  useApiMutation<string, McpOAuthDecision>((requestId) => ({
    method: "POST",
    url: `${requestUrl(requestId)}/approve`,
  }));

export const useDenyMcpOAuthRequestMutation = () =>
  useApiMutation<string, McpOAuthDecision>((requestId) => ({
    method: "POST",
    url: `${requestUrl(requestId)}/deny`,
  }));
