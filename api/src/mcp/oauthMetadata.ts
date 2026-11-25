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

/**
 * One permission an MCP OAuth client can be granted. The consent screen shows its `label` and
 * `description`; the server enforces its `access` level on every tool the token calls.
 */
export interface McpOAuthGrant {
  /** OAuth scope value. No spaces, since scopes are space-delimited on the wire. */
  scope: string;
  /** Short name the consent screen shows next to the grant's checkbox. */
  label: string;
  /** Longer explanation shown under the label. */
  description?: string;
  /** `read` allows read-only tools; `write` allows every tool, since write implies read. */
  access: McpOAuthGrantAccess;
}

/** Access level a grant gives. Write implies read. */
export type McpOAuthGrantAccess = "read" | "write";

/** Named grant sets for `mcpOAuth.grants`. */
export type McpOAuthGrantPreset = "readOnly" | "readWrite";

const READ_GRANT: McpOAuthGrant = {
  access: "read",
  description: "See your records. It cannot change anything.",
  label: "Read your data",
  scope: "mcp:read",
};

const WRITE_GRANT: McpOAuthGrant = {
  access: "write",
  description: "Create, update, and delete records for you.",
  label: "Change your data",
  scope: "mcp:write",
};

/** The grants each `mcpOAuth.grants` preset expands to, in consent-screen order. */
export const MCP_OAUTH_GRANT_PRESETS: Readonly<
  Record<McpOAuthGrantPreset, readonly McpOAuthGrant[]>
> = {
  readOnly: [READ_GRANT],
  readWrite: [READ_GRANT, WRITE_GRANT],
};

const GRANT_ACCESS_LEVELS = new Set<string>(["read", "write"]);

/** Grants a public PKCE client may register. Dynamic registration rejects anything else. */
export const PUBLIC_CLIENT_GRANT_TYPES = ["authorization_code", "refresh_token"];
const SUPPORTED_GRANT_TYPES = [...PUBLIC_CLIENT_GRANT_TYPES, "client_credentials"];
const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"];
export const SUPPORTED_RESPONSE_TYPES = ["code"];
export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Fetch used to load client metadata documents. Defaults to the global `fetch`. */
export type McpOAuthMetadataFetch = (
  url: string,
  init?: RequestInit
) => Promise<globalThis.Response>;

/** `mcpOAuth.clientIdMetadataDocuments`: which URL client ids the server accepts. */
export interface McpOAuthClientIdMetadataDocumentsOption {
  /**
   * Exact https URLs accepted as `client_id`, for example
   * `https://claude.ai/oauth/mcp-oauth-client-metadata`. No other URL is ever fetched.
   */
  allowedClientIds: string[];
  /** Injected for tests. Defaults to the global `fetch`. */
  fetch?: McpOAuthMetadataFetch;
}

/** `mcpOAuth.consent`: who may approve a connection. */
export interface McpOAuthConsentOption {
  /** Only users with `admin: true` may approve. Default false. */
  requireAdmin?: boolean;
  /**
   * Only users with Better Auth two-factor enabled may approve. Default false. Needs a registered
   * `BetterAuthApp` whose config sets `twoFactor`, or the app throws at boot.
   */
  requireTwoFactor?: boolean;
}

/** What the app around `mcpOAuth` provides, for boot checks that depend on it. */
export interface McpOAuthBootContext {
  /** Whether a Better Auth instance with the `twoFactor` plugin is registered. */
  betterAuthTwoFactor?: boolean;
}

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
  /**
   * Scopes advertised and accepted, without enforcement. Default: `["mcp"]`. Cannot be combined
   * with `grants`, which derives the scopes from its grants.
   */
  scopesSupported?: string[];
  /**
   * Enforced grants a client can request and the user can approve: the `"readOnly"` or
   * `"readWrite"` preset, or your own list. Sets `scopesSupported` to the grants' scopes. While
   * unset, the default `mcp` scope is accepted and not enforced.
   */
  grants?: McpOAuthGrantPreset | McpOAuthGrant[];
  /** Access token lifetime. Default: 3600 (one hour). */
  accessTokenTtlSeconds?: number;
  /** Refresh token lifetime. Default: 30 days. */
  refreshTokenTtlSeconds?: number;
  /** How long a pending authorization request waits for a consent decision. Default: 600. */
  authorizationRequestTtlSeconds?: number;
  /** How long an issued authorization code can be exchanged. Default: 60. */
  authorizationCodeTtlSeconds?: number;
  /**
   * Accept Client ID Metadata Documents (CIMD) for these exact https client ids, as Claude.ai's
   * "Use Claude's published identity" sends. `/oauth/authorize` fetches an allowlisted id's
   * document (no redirects, 5 s timeout, 16 KiB cap, cached 10 minutes) and stores it as a public
   * `McpOAuthClient`. Off when absent or empty.
   */
  clientIdMetadataDocuments?: McpOAuthClientIdMetadataDocumentsOption;
  /** Who may approve a connection. Unset, any signed-in user may. */
  consent?: McpOAuthConsentOption;
}

export type McpOAuthAppOption = McpOAuthOptions;

export interface ResolvedMcpOAuthOptions {
  accessTokenTtlSeconds: number;
  allowedRedirectHosts: string[];
  authorizationCodeTtlSeconds: number;
  authorizationRequestTtlSeconds: number;
  /** Allowlisted CIMD client ids and the fetch to load them, or undefined while off. */
  clientIdMetadataDocuments: {allowedClientIds: string[]; fetch: McpOAuthMetadataFetch} | undefined;
  /** Approval policy, enforced on the consent endpoints. */
  consent: {requireAdmin: boolean; requireTwoFactor: boolean};
  consentUrl: string;
  dynamicClientRegistration: boolean;
  issuer: string;
  refreshTokenTtlSeconds: number;
  resource: string;
  /** URL of the RFC 9728 protected-resource metadata for {@link resource}. */
  resourceMetadataUrl: string;
  scopesSupported: string[];
  /** Enforced grants, or undefined while `mcpOAuth.grants` is unset. */
  grants: McpOAuthGrant[] | undefined;
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

const resolveGrants = (grants: McpOAuthOptions["grants"]): McpOAuthGrant[] => {
  if (typeof grants === "string") {
    if (!Object.hasOwn(MCP_OAUTH_GRANT_PRESETS, grants)) {
      throw misconfigured(
        `mcpOAuth.grants must be "readOnly", "readWrite", or a list of grants, got "${grants}"`
      );
    }
    return MCP_OAUTH_GRANT_PRESETS[grants].map((grant) => ({...grant}));
  }
  if (!Array.isArray(grants) || grants.length === 0) {
    throw misconfigured("mcpOAuth.grants must list at least one grant");
  }
  const seen = new Set<string>();
  for (const grant of grants) {
    if (typeof grant?.scope !== "string" || !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(grant.scope)) {
      throw misconfigured(
        `mcpOAuth.grants scope must be a non-empty string without spaces, got "${grant?.scope}"`
      );
    }
    if (seen.has(grant.scope)) {
      throw misconfigured(`mcpOAuth.grants lists scope "${grant.scope}" more than once`);
    }
    seen.add(grant.scope);
    if (typeof grant.label !== "string" || grant.label.trim() === "") {
      throw misconfigured(`mcpOAuth.grants "${grant.scope}" needs a label`);
    }
    if (!GRANT_ACCESS_LEVELS.has(grant.access)) {
      throw misconfigured(
        `mcpOAuth.grants "${grant.scope}" access must be "read" or "write", got "${grant.access}"`
      );
    }
  }
  return grants;
};

const resolveClientIdMetadataDocuments = (
  option: McpOAuthClientIdMetadataDocumentsOption | undefined
): ResolvedMcpOAuthOptions["clientIdMetadataDocuments"] => {
  const ids = option?.allowedClientIds ?? [];
  if (!Array.isArray(ids)) {
    throw misconfigured("mcpOAuth.clientIdMetadataDocuments.allowedClientIds must be an array");
  }
  if (ids.length === 0) {
    return undefined;
  }
  for (const id of ids) {
    const parsed = URL.canParse(id) ? new URL(id) : undefined;
    // An exact, normalized https URL with a path, so the string the client sends is the URL fetched.
    if (
      parsed?.protocol !== "https:" ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname === "/" ||
      parsed.href !== id
    ) {
      throw misconfigured(
        `mcpOAuth.clientIdMetadataDocuments.allowedClientIds must be https URLs with a path and no query or fragment, got "${id}"`
      );
    }
  }
  return {allowedClientIds: [...ids], fetch: option?.fetch ?? ((url, init) => fetch(url, init))};
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
  option: McpOAuthAppOption | undefined,
  context: McpOAuthBootContext = {}
): ResolvedMcpOAuthOptions | undefined => {
  if (!option?.enabled) {
    return undefined;
  }
  const consent = {
    requireAdmin: option.consent?.requireAdmin === true,
    requireTwoFactor: option.consent?.requireTwoFactor === true,
  };
  if (consent.requireTwoFactor && !context.betterAuthTwoFactor) {
    throw misconfigured(
      "mcpOAuth.consent.requireTwoFactor needs a BetterAuthApp whose config sets twoFactor"
    );
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
  if (option.grants !== undefined && option.scopesSupported !== undefined) {
    throw misconfigured("mcpOAuth: set grants or scopesSupported, not both");
  }
  const grants = option.grants === undefined ? undefined : resolveGrants(option.grants);
  const scopesSupported =
    grants?.map((grant) => grant.scope) ?? option.scopesSupported ?? DEFAULT_SCOPES;
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
    clientIdMetadataDocuments: resolveClientIdMetadataDocuments(option.clientIdMetadataDocuments),
    consent,
    consentUrl: option.consentUrl,
    dynamicClientRegistration,
    grants,
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
  // An explicit JSON content type keeps reflected request values from rendering as HTML.
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(body));
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
  ...(oauth.clientIdMetadataDocuments ? {client_id_metadata_document_supported: true} : {}),
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
  token_endpoint_auth_methods_supported: SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS,
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
