import {openapi} from "./sdk";

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

/**
 * MCP OAuth consent endpoints from `@terreno/api`. They ride the SPA's cookie-session API,
 * so the Better Auth session cookie authenticates them on the same origin, with no bearer.
 */
const mcpOAuthConsentApi = openapi.injectEndpoints({
  endpoints: (build) => ({
    approveMcpOAuthRequest: build.mutation<McpOAuthDecision, string>({
      query: (requestId) => ({
        method: "POST",
        url: `/oauth/authorize/${encodeURIComponent(requestId)}/approve`,
      }),
    }),
    denyMcpOAuthRequest: build.mutation<McpOAuthDecision, string>({
      query: (requestId) => ({
        method: "POST",
        url: `/oauth/authorize/${encodeURIComponent(requestId)}/deny`,
      }),
    }),
    getMcpOAuthRequest: build.query<McpOAuthRequest, string>({
      // A pending request changes state when decided elsewhere; never serve it from cache.
      keepUnusedDataFor: 0,
      query: (requestId) => ({
        method: "GET",
        url: `/oauth/authorize/${encodeURIComponent(requestId)}`,
      }),
    }),
  }),
});

export const {
  useApproveMcpOAuthRequestMutation,
  useDenyMcpOAuthRequestMutation,
  useGetMcpOAuthRequestQuery,
} = mcpOAuthConsentApi;
