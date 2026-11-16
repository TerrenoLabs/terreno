/**
 * Helpers for MCP OAuth specs: start an authorization as an MCP client would (dynamic client
 * registration plus PKCE S256), exchange the code, and call /mcp with the resulting bearer.
 * Adapted from admin-spa/e2e/integration/oauthConsent.integration.spec.ts.
 */
import {createHash, randomBytes} from "node:crypto";
import {type APIRequestContext, expect} from "@playwright/test";

export const OAUTH_API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
export const OAUTH_REDIRECT_URI = "http://127.0.0.1:9/callback";

export interface PendingAuthorization {
  clientId: string;
  /** Path and query of the consent screen the authorize call redirected to. */
  consentPath: string;
  requestId: string;
  state: string;
  verifier: string;
}

export interface TokenResponse {
  access_token?: string;
  scope?: string;
}

const base64Url = (buffer: Buffer): string =>
  buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

/** True when the backend runs without MCP_OAUTH_ENABLED (the metadata route is not mounted). */
export const isOAuthDisabled = async (api: APIRequestContext): Promise<boolean> => {
  const metadata = await api.get(`${OAUTH_API_URL}/.well-known/oauth-authorization-server`);
  return metadata.status() === 404;
};

/** Registers a public client and starts the authorization-code flow, as Claude.ai would. */
export const startAuthorization = async (api: APIRequestContext): Promise<PendingAuthorization> => {
  const register = await api.post(`${OAUTH_API_URL}/oauth/register`, {
    data: {client_name: "E2E Connector", redirect_uris: [OAUTH_REDIRECT_URI]},
  });
  expect(register.status()).toBe(201);
  const {client_id: clientId} = (await register.json()) as {client_id: string};

  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(8));
  const params = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    state,
  });
  const authorize = await api.get(`${OAUTH_API_URL}/oauth/authorize?${params.toString()}`, {
    maxRedirects: 0,
  });
  expect(authorize.status()).toBe(302);
  const location = new URL(authorize.headers().location);
  const requestId = location.searchParams.get("request") ?? "";
  expect(requestId).toBeTruthy();
  return {
    clientId,
    consentPath: `${location.pathname}${location.search}`,
    requestId,
    state,
    verifier,
  };
};

/** Exchanges an authorization code (PKCE) at /oauth/token. */
export const exchangeCode = async (
  api: APIRequestContext,
  pending: PendingAuthorization,
  code: string
): Promise<{body: TokenResponse; status: number}> => {
  const res = await api.post(`${OAUTH_API_URL}/oauth/token`, {
    form: {
      client_id: pending.clientId,
      code,
      code_verifier: pending.verifier,
      grant_type: "authorization_code",
      redirect_uri: OAUTH_REDIRECT_URI,
    },
  });
  return {body: (await res.json().catch(() => ({}))) as TokenResponse, status: res.status()};
};

/** Calls /mcp with a JSON-RPC request and returns the parsed message (JSON or SSE framed). */
export const callMcp = async (
  api: APIRequestContext,
  bearer: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<{
  error?: unknown;
  result?: {content?: unknown; isError?: boolean; tools?: Array<{name: string}>};
}> => {
  const res = await api.post(`${OAUTH_API_URL}/mcp`, {
    data: {id: 1, jsonrpc: "2.0", method, params},
    headers: {accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}`},
  });
  const text = await res.text();
  const payload = text.startsWith("{")
    ? text
    : (text
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim() ?? "{}");
  return JSON.parse(payload);
};
