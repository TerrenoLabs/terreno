/**
 * Option resolution, RFC 9728 / RFC 8414 discovery documents, and the `/mcp` 401 challenge for
 * MCP OAuth. Kept apart from the authorization-server routes in `oauth.ts` so any auth stack
 * can serve the same metadata and challenge.
 */
import type {Response} from "express";

import {APIError} from "../errors";

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_AUTHORIZATION_REQUEST_TTL_SECONDS = 10 * 60;
const DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS = 60;
const DEFAULT_SCOPES = ["mcp"];

export const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"];
export const SUPPORTED_RESPONSE_TYPES = ["code"];
export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface McpOAuthOptions {
  /** Turns the authorization server on. Every other field is ignored while false. */
  enabled: boolean;
  /**
   * Public origin of this API, for example `https://api.example.com`. It is the RFC 8414
   * `issuer`, and every endpoint URL in the metadata is built from it. It must be an origin with
   * no path, because the well-known documents are served from the root of this app.
   */
  issuer: string;
  /**
   * App page that hosts the consent screen. `/oauth/authorize` redirects the browser here with
   * `?request=<id>` added. The page reads the request with `GET /oauth/authorize/:request` and
   * posts the user's decision to `/oauth/authorize/:request/approve` or `/deny`.
   */
  consentUrl: string;
  /**
   * Mount RFC 7591 dynamic client registration at `POST /oauth/register` and advertise it in the
   * metadata. Default: false. The endpoint is unauthenticated, so anyone who can reach the API
   * can create a client; the consent screen is then the only gate. While off, only clients you
   * create as `McpOAuthClient` documents can run the flow, and `/oauth/register` returns 404.
   */
  dynamicClientRegistration?: boolean;
  /**
   * Hostnames a registering client may put redirect URIs on, for example
   * `["claude.ai", "chatgpt.com"]`. Required with `dynamicClientRegistration`, unused without it.
   * `*.example.com` matches any subdomain. Add `localhost` to allow loopback `http://` redirects
   * for local clients.
   */
  allowedRedirectHosts?: string[];
  /** RFC 8707 resource identifier for `/mcp`. Default: `${issuer}/mcp`. */
  resource?: string;
  /** Scopes advertised and accepted. Default: `["mcp"]`. */
  scopesSupported?: string[];
  /** Access token lifetime. Default: 3600 (one hour). */
  accessTokenTtlSeconds?: number;
  /** Refresh token lifetime. Default: 30 days. */
  refreshTokenTtlSeconds?: number;
  /** How long a pending authorization request waits for a consent decision. Default: 600. */
  authorizationRequestTtlSeconds?: number;
  /** How long an issued authorization code can be exchanged. Default: 60. */
  authorizationCodeTtlSeconds?: number;
}

export type McpOAuthAppOption = McpOAuthOptions;

export interface ResolvedMcpOAuthOptions {
  accessTokenTtlSeconds: number;
  allowedRedirectHosts: string[];
  authorizationCodeTtlSeconds: number;
  authorizationRequestTtlSeconds: number;
  consentUrl: string;
  dynamicClientRegistration: boolean;
  issuer: string;
  refreshTokenTtlSeconds: number;
  resource: string;
  /** URL of the RFC 9728 protected-resource metadata for {@link resource}. */
  resourceMetadataUrl: string;
  scopesSupported: string[];
}

const misconfigured = (detail: string): APIError =>
  new APIError({
    code: "mcp-oauth-misconfigured",
    detail,
    status: 500,
    title: "MCP OAuth is misconfigured",
  });

const parseAbsoluteUrl = (value: string, field: string): URL => {
  try {
    return new URL(value);
  } catch {
    throw misconfigured(`mcpOAuth.${field} must be an absolute URL, got "${value}"`);
  }
};

const positiveInteger = (value: number | undefined, fallback: number, field: string): number => {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw misconfigured(`mcpOAuth.${field} must be a positive integer`);
  }
  return value;
};

/** RFC 9728 §3.1: the well-known segment goes between the host and the resource's path. */
export const protectedResourceMetadataPath = (resource: string): string => {
  const {pathname} = new URL(resource);
  const suffix = pathname === "/" ? "" : pathname.replace(/\/$/, "");
  return `/.well-known/oauth-protected-resource${suffix}`;
};

/**
 * Validate and default the `mcpOAuth` TerrenoApp option. Returns undefined while disabled.
 * Misconfiguration throws at boot rather than failing the first client's flow.
 */
export const resolveMcpOAuthOption = (
  option: McpOAuthAppOption | undefined
): ResolvedMcpOAuthOptions | undefined => {
  if (!option?.enabled) {
    return undefined;
  }
  const issuerUrl = parseAbsoluteUrl(option.issuer, "issuer");
  if (issuerUrl.pathname !== "/" || issuerUrl.search || issuerUrl.hash) {
    throw misconfigured("mcpOAuth.issuer must be an origin with no path, query, or fragment");
  }
  if (issuerUrl.protocol !== "https:" && !LOOPBACK_HOSTS.has(issuerUrl.hostname)) {
    throw misconfigured("mcpOAuth.issuer must use https outside localhost");
  }
  parseAbsoluteUrl(option.consentUrl, "consentUrl");
  const dynamicClientRegistration = option.dynamicClientRegistration === true;
  const allowedRedirectHosts = option.allowedRedirectHosts ?? [];
  if (dynamicClientRegistration && allowedRedirectHosts.length === 0) {
    throw misconfigured(
      "mcpOAuth.allowedRedirectHosts must list at least one host when dynamicClientRegistration is on"
    );
  }
  const issuer = issuerUrl.origin;
  const resource = option.resource ?? `${issuer}/mcp`;
  parseAbsoluteUrl(resource, "resource");
  const scopesSupported = option.scopesSupported ?? DEFAULT_SCOPES;
  if (scopesSupported.length === 0) {
    throw misconfigured("mcpOAuth.scopesSupported must list at least one scope");
  }
  return {
    accessTokenTtlSeconds: positiveInteger(
      option.accessTokenTtlSeconds,
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      "accessTokenTtlSeconds"
    ),
    allowedRedirectHosts: allowedRedirectHosts.map((host) => host.toLowerCase()),
    authorizationCodeTtlSeconds: positiveInteger(
      option.authorizationCodeTtlSeconds,
      DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS,
      "authorizationCodeTtlSeconds"
    ),
    authorizationRequestTtlSeconds: positiveInteger(
      option.authorizationRequestTtlSeconds,
      DEFAULT_AUTHORIZATION_REQUEST_TTL_SECONDS,
      "authorizationRequestTtlSeconds"
    ),
    consentUrl: option.consentUrl,
    dynamicClientRegistration,
    issuer,
    refreshTokenTtlSeconds: positiveInteger(
      option.refreshTokenTtlSeconds,
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
      "refreshTokenTtlSeconds"
    ),
    resource,
    resourceMetadataUrl: `${issuer}${protectedResourceMetadataPath(resource)}`,
    scopesSupported,
  };
};

/**
 * Protocol responses bypass `res.json`, which TerrenoApp wraps to add `requestId`, so clients
 * get exactly the RFC-defined members.
 */
export const sendProtocolJson = (res: Response, status: number, body: unknown): void => {
  res.status(status).type("application/json").send(JSON.stringify(body));
};

/** RFC 9728 protected-resource metadata. */
export const buildProtectedResourceMetadata = (
  oauth: ResolvedMcpOAuthOptions
): Record<string, unknown> => ({
  authorization_servers: [oauth.issuer],
  bearer_methods_supported: ["header"],
  resource: oauth.resource,
  scopes_supported: oauth.scopesSupported,
});

/** RFC 8414 authorization-server metadata. */
export const buildAuthorizationServerMetadata = (
  oauth: ResolvedMcpOAuthOptions
): Record<string, unknown> => ({
  ...(oauth.dynamicClientRegistration
    ? {registration_endpoint: `${oauth.issuer}/oauth/register`}
    : {}),
  authorization_endpoint: `${oauth.issuer}/oauth/authorize`,
  authorization_response_iss_parameter_supported: true,
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: SUPPORTED_GRANT_TYPES,
  issuer: oauth.issuer,
  response_types_supported: SUPPORTED_RESPONSE_TYPES,
  revocation_endpoint: `${oauth.issuer}/oauth/revoke`,
  revocation_endpoint_auth_methods_supported: ["none"],
  scopes_supported: oauth.scopesSupported,
  token_endpoint: `${oauth.issuer}/oauth/token`,
  token_endpoint_auth_methods_supported: ["none"],
});

/**
 * Answer an unauthenticated `/mcp` request with the RFC 9728 challenge that starts a client's
 * OAuth discovery. `invalidToken` marks a presented-but-rejected credential so clients refresh.
 */
export const sendMcpOAuthChallenge = (
  res: Response,
  oauth: ResolvedMcpOAuthOptions,
  {invalidToken}: {invalidToken: boolean}
): void => {
  const params = [`resource_metadata="${oauth.resourceMetadataUrl}"`];
  if (invalidToken) {
    params.push('error="invalid_token"');
  }
  res.setHeader("WWW-Authenticate", `Bearer ${params.join(", ")}`);
  sendProtocolJson(res, 401, {
    error: invalidToken ? "invalid_token" : "unauthorized",
    error_description: invalidToken
      ? "The access token is invalid, expired, or revoked"
      : "Authentication required",
  });
};
