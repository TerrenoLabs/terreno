/**
 * Terreno-native OAuth 2.1 authorization server for `/mcp`, for apps that authenticate with
 * Terreno JWTs. Remote MCP clients (Claude.ai connectors, ChatGPT apps) discover it through
 * RFC 9728 / RFC 8414 metadata, register with RFC 7591 dynamic client registration, and run the
 * authorization-code flow with PKCE S256. Terreno is backend-only, so the app hosts the consent
 * screen at `consentUrl` and calls the approve/deny endpoints with the signed-in user's JWT.
 */
import {createHash, randomUUID, timingSafeEqual} from "node:crypto";
import type {Application, NextFunction, Request, RequestHandler, Response} from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {asyncHandler, type OpenApiMiddleware} from "../api";
import {authenticateMiddleware, type User, type UserModel} from "../auth";
import type {BetterAuthInstance} from "../betterAuthSetup";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../errors";
import {logger} from "../logger";
import {McpOAuthAuthorization} from "../models/mcpOAuthAuthorization";
import {McpOAuthClient} from "../models/mcpOAuthClient";
import {
  generateMcpOAuthSecret,
  hashMcpOAuthSecret,
  MCP_OAUTH_ACCESS_TOKEN_PREFIX,
  McpOAuthFamilyRevokedError,
  McpOAuthToken,
} from "../models/mcpOAuthToken";
import {MCP_SERVICE_TOKEN_PREFIX} from "../models/mcpServiceToken";
import {createOpenApiBuilder} from "../openApiBuilder";
import {createRouteRateLimitMiddleware} from "../rateLimit/routeRateLimit";
import type {
  McpOAuthAuthorizationDocument,
  McpOAuthClientDocument,
  McpOAuthTokenIssueOptions,
  McpOAuthTokenModel,
} from "../types/mcpOAuth";
import {bearerFromHeaders, isCredentialEpochStale, userTokenEpoch} from "./auth";
import {
  ClientMetadataDocumentError,
  type ClientMetadataDocumentResolver,
  createClientMetadataDocumentResolver,
} from "./oauthClientMetadataDocument";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  LOOPBACK_HOSTS,
  type McpOAuthGrant,
  PUBLIC_CLIENT_GRANT_TYPES,
  protectedResourceMetadataPath,
  type ResolvedMcpOAuthOptions,
  SUPPORTED_RESPONSE_TYPES,
  sendProtocolJson,
} from "./oauthMetadata";

// Keep a used code's record long enough to detect a replay and revoke what it issued.
const USED_CODE_RETENTION_SECONDS = 60 * 60;

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const MAX_CLIENT_NAME_LENGTH = 200;
const MAX_REDIRECT_URIS = 10;

export interface McpOAuthRoutesOptions {
  /** The app's Better Auth instance, for the two-factor approval policy and the built-in page. */
  betterAuth?: BetterAuthInstance;
  oauth: ResolvedMcpOAuthOptions;
  openApi?: OpenApiMiddleware;
  userModel: UserModel;
}

/** An RFC 6749 §5.2-shaped error, sent as `{error, error_description}` instead of JSON:API. */
class OAuthProtocolError extends Error {
  readonly error: string;
  readonly status: number;

  constructor(error: string, description: string, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

/** Issue a pair into a family; a family revoked by a concurrent request answers `invalid_grant`. */
const issueOrInvalidGrant = async (
  options: McpOAuthTokenIssueOptions
): Promise<Awaited<ReturnType<McpOAuthTokenModel["issue"]>>> => {
  try {
    return await McpOAuthToken.issue(options);
  } catch (error) {
    if (error instanceof McpOAuthFamilyRevokedError) {
      logger.warn("[MCPOAuth] Refused to issue into a revoked token family", {
        clientId: options.clientId,
      });
      throw new OAuthProtocolError("invalid_grant", "The grant was revoked");
    }
    throw error;
  }
};

const oauthHandler = (
  handler: (req: Request, res: Response) => Promise<void>
): ((req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof OAuthProtocolError) {
        res.setHeader("Cache-Control", "no-store");
        sendProtocolJson(res, error.status, {
          error: error.error,
          error_description: error.message,
        });
        return;
      }
      next(error);
    }
  };
};

const stringParam = (value: unknown): string | undefined => {
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const hostMatches = (hostname: string, pattern: string): boolean => {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
};

/** Returns why a redirect URI is not acceptable, or undefined when it is. */
const redirectUriProblem = (uri: unknown, allowedHosts: string[]): string | undefined => {
  if (typeof uri !== "string") {
    return "redirect_uris must be strings";
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return `${uri} is not an absolute URL`;
  }
  if (parsed.hash) {
    return `${uri} must not contain a fragment`;
  }
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    return `${uri} must use https (http is allowed only for loopback hosts)`;
  }
  if (!allowedHosts.some((pattern) => hostMatches(hostname, pattern))) {
    return `${hostname} is not an allowed redirect host`;
  }
  return undefined;
};

const parseScope = (scope: string | undefined, supported: string[]): string => {
  if (!scope) {
    return supported.join(" ");
  }
  const requested = scope.split(" ").filter(Boolean);
  const unknown = requested.filter((value) => !supported.includes(value));
  if (unknown.length > 0) {
    throw new OAuthProtocolError("invalid_scope", `Unsupported scope: ${unknown.join(" ")}`);
  }
  return requested.join(" ");
};

const splitScope = (scope: string | undefined | null): string[] => {
  return (scope ?? "").split(" ").filter((value) => value.length > 0);
};

/** The consent-screen view of one grant. */
export interface McpOAuthConsentGrant {
  access: McpOAuthGrant["access"];
  description: string | null;
  label: string;
  scope: string;
}

/**
 * Describe each requested scope for the consent screen, in requested order. Without configured
 * grants a scope is shown by name and treated as full access, since nothing narrows it.
 */
export const consentGrantsFor = (
  scope: string | undefined | null,
  grants: McpOAuthGrant[] | undefined
): McpOAuthConsentGrant[] => {
  return splitScope(scope).map((value) => {
    const grant = grants?.find((candidate) => candidate.scope === value);
    if (!grant) {
      return {access: "write", description: null, label: value, scope: value};
    }
    return {
      access: grant.access,
      description: grant.description ?? null,
      label: grant.label,
      scope: grant.scope,
    };
  });
};

/**
 * The scope the user approved: the full requested scope when the consent screen sends none, or a
 * non-empty subset of it. Approval can narrow a request but never widen it.
 */
const approvedScope = (body: unknown, requested: string | undefined | null): string | undefined => {
  const narrowed = (body as {scope?: unknown} | null | undefined)?.scope;
  if (narrowed === undefined) {
    return requested ?? undefined;
  }
  if (typeof narrowed !== "string") {
    throw new BadRequestError({
      detail: "scope must be a space-separated string",
      title: "Invalid scope",
    });
  }
  const chosen = [...new Set(splitScope(narrowed))];
  if (chosen.length === 0) {
    throw new BadRequestError({
      detail: "Approve at least one of the requested permissions",
      title: "Choose at least one permission",
    });
  }
  const requestedScopes = splitScope(requested);
  const extra = chosen.filter((value) => !requestedScopes.includes(value));
  if (extra.length > 0) {
    throw new BadRequestError({
      detail: `Not requested by the client: ${extra.join(" ")}`,
      title: "Scope was not requested",
    });
  }
  // Keep the client's requested order so the issued scope string is stable.
  return requestedScopes.filter((value) => chosen.includes(value)).join(" ");
};

const normalizeResource = (resource: string): string => resource.replace(/\/$/, "");

const pkceS256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

const appendParams = (base: string, params: Record<string, string | undefined>): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

const userIsDisabled = (user: unknown): boolean => {
  return Boolean((user as {disabled?: boolean} | null)?.disabled);
};

const rejectDelegatedCredentials = (req: Request, _res: Response, next: NextFunction): void => {
  const {token} = bearerFromHeaders(req.headers);
  if (
    token?.startsWith(MCP_SERVICE_TOKEN_PREFIX) ||
    token?.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX)
  ) {
    next(new UnauthorizedError("Delegated MCP credentials cannot decide OAuth requests"));
    return;
  }
  next();
};

const consentGuards = [rejectDelegatedCredentials, authenticateMiddleware()];

/** Per-IP limit on the approve endpoint, on top of the app-wide limiter. Per process. */
const MCP_OAUTH_APPROVE_RATE_LIMIT = {max: 30, windowMs: 60_000};

const requireUser = (req: Request): User => {
  const user = req.user as unknown as User | undefined;
  if (!user?._id) {
    throw new UnauthorizedError("Unauthorized");
  }
  return user;
};

/** Load a pending request for the consent endpoints, or explain why it cannot be decided. */
export const loadPendingAuthorization = async (
  requestId: string
): Promise<McpOAuthAuthorizationDocument> => {
  const authorization = await McpOAuthAuthorization.findOneOrNone({requestId});
  if (!authorization) {
    throw new NotFoundError("Authorization request not found");
  }
  if (authorization.status !== "pending") {
    throw new ConflictError({
      code: "mcp-oauth-request-decided",
      title: "Authorization request was already decided",
    });
  }
  if (DateTime.fromJSDate(authorization.expiresAt) <= DateTime.now()) {
    throw new BadRequestError({
      code: "mcp-oauth-request-expired",
      title: "Authorization request expired",
    });
  }
  return authorization;
};

/** The client of a pending request, refusing one that was revoked or removed after authorize. */
export const loadActiveClient = async (clientId: string): Promise<McpOAuthClientDocument> => {
  const client = await McpOAuthClient.findOneOrNone({clientId});
  if (!client || client.revokedAt) {
    throw new BadRequestError({
      code: "mcp-oauth-client-revoked",
      title: "The client was revoked",
    });
  }
  return client;
};

interface TwoFactorUserContext {
  internalAdapter: {
    findUserById: (userId: string) => Promise<{twoFactorEnabled?: boolean | null} | null>;
  };
}

/** Whether the user's linked Better Auth account has two-factor turned on. */
const hasTwoFactorEnabled = async (
  user: User,
  betterAuth: BetterAuthInstance | undefined
): Promise<boolean> => {
  const betterAuthId = (user as {betterAuthId?: unknown}).betterAuthId;
  if (!betterAuth || typeof betterAuthId !== "string" || betterAuthId === "") {
    return false;
  }
  const context = (await betterAuth.$context) as unknown as TwoFactorUserContext;
  const betterAuthUser = await context.internalAdapter.findUserById(betterAuthId);
  return betterAuthUser?.twoFactorEnabled === true;
};

/** Why `mcpOAuth.consent` refuses this user as an approver, or undefined when it allows them. */
export const approvalPolicyProblem = async (
  user: User,
  oauth: ResolvedMcpOAuthOptions,
  betterAuth: BetterAuthInstance | undefined
): Promise<string | undefined> => {
  if (oauth.consent.requireAdmin && (user as {admin?: unknown}).admin !== true) {
    return "Only an admin can approve this connection";
  }
  if (oauth.consent.requireTwoFactor && !(await hasTwoFactorEnabled(user, betterAuth))) {
    return "Turn on two-factor authentication to approve this connection";
  }
  return undefined;
};

/**
 * Approve a pending request as `user` and return the client redirect carrying the code. Shared
 * by the JSON approve endpoint and the built-in consent page, which check the approval policy
 * first. Refuses a client revoked since authorize.
 */
export const approveAuthorization = async ({
  oauth,
  pending,
  scope,
  user,
}: {
  oauth: ResolvedMcpOAuthOptions;
  pending: McpOAuthAuthorizationDocument;
  scope: string | undefined;
  user: User;
}): Promise<string> => {
  await loadActiveClient(pending.clientId);
  const code = generateMcpOAuthSecret();
  const now = DateTime.now();
  const codeExpiresAt = now.plus({seconds: oauth.authorizationCodeTtlSeconds});
  const expiresAt = DateTime.max(
    DateTime.fromJSDate(pending.expiresAt),
    codeExpiresAt.plus({seconds: USED_CODE_RETENTION_SECONDS})
  );
  const approved = await McpOAuthAuthorization.findOneAndUpdate(
    {_id: pending._id, status: "pending"},
    {
      $set: {
        codeExpiresAt: codeExpiresAt.toJSDate(),
        codeHash: hashMcpOAuthSecret(code),
        expiresAt: expiresAt.toJSDate(),
        ...(scope === undefined ? {} : {scope}),
        status: "approved",
        tokenEpoch: userTokenEpoch(user),
        userId: new mongoose.Types.ObjectId(String(user._id)),
      },
    },
    {returnDocument: "after"}
  );
  if (!approved) {
    throw new ConflictError({
      code: "mcp-oauth-request-decided",
      title: "Authorization request was already decided",
    });
  }
  logger.info("[MCPOAuth] Authorization approved", {
    clientId: approved.clientId,
    userId: String(user._id),
  });
  return appendParams(approved.redirectUri, {code, iss: oauth.issuer, state: approved.state});
};

/**
 * Deny a pending request and return the client redirect carrying `error=access_denied`. The
 * built-in consent page denies without a signed-in user, so `userId` is optional.
 */
export const denyAuthorization = async ({
  oauth,
  pending,
  userId,
}: {
  oauth: ResolvedMcpOAuthOptions;
  pending: McpOAuthAuthorizationDocument;
  userId?: string;
}): Promise<string> => {
  const denied = await McpOAuthAuthorization.findOneAndUpdate(
    {_id: pending._id, status: "pending"},
    {
      $set: {
        status: "denied",
        ...(userId ? {userId: new mongoose.Types.ObjectId(userId)} : {}),
      },
    },
    {returnDocument: "after"}
  );
  if (!denied) {
    throw new ConflictError({
      code: "mcp-oauth-request-decided",
      title: "Authorization request was already decided",
    });
  }
  return appendParams(denied.redirectUri, {
    error: "access_denied",
    error_description: "The user denied the request",
    iss: oauth.issuer,
    state: denied.state,
  });
};

const addDiscoveryRoutes = (app: Application, oauth: ResolvedMcpOAuthOptions): void => {
  const protectedResource = (_req: Request, res: Response): void => {
    sendProtocolJson(res, 200, buildProtectedResourceMetadata(oauth));
  };
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  const resourcePath = protectedResourceMetadataPath(oauth.resource);
  if (resourcePath !== "/.well-known/oauth-protected-resource") {
    app.get(resourcePath, protectedResource);
  }
  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    sendProtocolJson(res, 200, buildAuthorizationServerMetadata(oauth));
  });
};

const addRegistrationRoute = (app: Application, oauth: ResolvedMcpOAuthOptions): void => {
  app.post(
    "/oauth/register",
    oauthHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const redirectUris = body.redirect_uris;
      if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
        throw new OAuthProtocolError("invalid_redirect_uri", "redirect_uris is required");
      }
      if (redirectUris.length > MAX_REDIRECT_URIS) {
        throw new OAuthProtocolError(
          "invalid_redirect_uri",
          `At most ${MAX_REDIRECT_URIS} redirect_uris are allowed`
        );
      }
      for (const uri of redirectUris) {
        const problem = redirectUriProblem(uri, oauth.allowedRedirectHosts);
        if (problem) {
          throw new OAuthProtocolError("invalid_redirect_uri", problem);
        }
      }

      const authMethod = body.token_endpoint_auth_method ?? "none";
      if (authMethod !== "none") {
        throw new OAuthProtocolError(
          "invalid_client_metadata",
          "Only public clients are supported: token_endpoint_auth_method must be none"
        );
      }
      const grantTypes = (body.grant_types as unknown[] | undefined) ?? PUBLIC_CLIENT_GRANT_TYPES;
      if (
        !Array.isArray(grantTypes) ||
        !grantTypes.includes("authorization_code") ||
        grantTypes.some((grant) => !PUBLIC_CLIENT_GRANT_TYPES.includes(grant as string))
      ) {
        throw new OAuthProtocolError(
          "invalid_client_metadata",
          "grant_types must include authorization_code and may add refresh_token"
        );
      }
      const responseTypes =
        (body.response_types as unknown[] | undefined) ?? SUPPORTED_RESPONSE_TYPES;
      if (
        !Array.isArray(responseTypes) ||
        responseTypes.some((type) => !SUPPORTED_RESPONSE_TYPES.includes(type as string))
      ) {
        throw new OAuthProtocolError("invalid_client_metadata", "response_types must be [code]");
      }
      const clientName = stringParam(body.client_name)?.slice(0, MAX_CLIENT_NAME_LENGTH);
      let scope: string | undefined;
      try {
        scope = body.scope ? parseScope(stringParam(body.scope), oauth.scopesSupported) : undefined;
      } catch (error) {
        throw new OAuthProtocolError("invalid_client_metadata", (error as Error).message);
      }

      const client = await McpOAuthClient.create({
        clientId: randomUUID(),
        clientName,
        grantTypes: grantTypes as string[],
        redirectUris: redirectUris as string[],
        responseTypes: responseTypes as string[],
        scope,
      });
      logger.info("[MCPOAuth] Registered client", {clientId: client.clientId, clientName});
      res.setHeader("Cache-Control", "no-store");
      sendProtocolJson(res, 201, {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(DateTime.fromJSDate(client.created).toSeconds()),
        client_name: client.clientName,
        grant_types: client.grantTypes,
        redirect_uris: client.redirectUris,
        response_types: client.responseTypes,
        scope: client.scope,
        token_endpoint_auth_method: "none",
      });
    })
  );
};

/**
 * RFC 8252 §7.3: a native client binds an ephemeral port, so a loopback redirect matches a
 * registered loopback URI when scheme, hostname, path, and query match. The port is ignored.
 * `localhost`, `127.0.0.1`, and `[::1]` stay distinct hosts. Every other URI stays an exact match.
 */
const redirectUriMatchesRegistered = (requested: string, registered: string[]): boolean => {
  if (registered.includes(requested)) {
    return true;
  }
  let requestedUrl: URL;
  try {
    requestedUrl = new URL(requested);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(requestedUrl.hostname)) {
    return false;
  }
  return registered.some((candidate) => {
    let registeredUrl: URL;
    try {
      registeredUrl = new URL(candidate);
    } catch {
      return false;
    }
    return (
      LOOPBACK_HOSTS.has(registeredUrl.hostname) &&
      registeredUrl.protocol === requestedUrl.protocol &&
      registeredUrl.hostname === requestedUrl.hostname &&
      registeredUrl.pathname === requestedUrl.pathname &&
      registeredUrl.search === requestedUrl.search
    );
  });
};

/**
 * The client an authorization request names. An allowlisted metadata-document id is fetched (or
 * served from cache) and stored as a public client; a revoked one is refused before any fetch.
 * Every other id must already be a stored client.
 */
const resolveAuthorizeClient = async (
  clientId: string,
  metadataDocuments: ClientMetadataDocumentResolver | undefined
): Promise<McpOAuthClientDocument> => {
  const stored = await McpOAuthClient.findOneOrNone({clientId});
  if (stored?.revokedAt) {
    throw new OAuthProtocolError("invalid_request", "Unknown client_id");
  }
  if (!metadataDocuments?.isAllowed(clientId)) {
    if (!stored) {
      throw new OAuthProtocolError("invalid_request", "Unknown client_id");
    }
    return stored;
  }
  let document: Awaited<ReturnType<ClientMetadataDocumentResolver["load"]>>;
  try {
    document = await metadataDocuments.load(clientId);
  } catch (error) {
    if (error instanceof ClientMetadataDocumentError) {
      logger.warn("[MCPOAuth] Refused a client metadata document", {
        clientId,
        reason: error.message,
      });
      throw new OAuthProtocolError("invalid_request", error.message);
    }
    throw error;
  }
  const client = await McpOAuthClient.upsertFromMetadataDocument(document);
  if (!client) {
    throw new OAuthProtocolError("invalid_request", "Unknown client_id");
  }
  return client;
};

const addAuthorizeRoute = (
  app: Application,
  oauth: ResolvedMcpOAuthOptions,
  metadataDocuments: ClientMetadataDocumentResolver | undefined
): void => {
  app.get(
    "/oauth/authorize",
    oauthHandler(async (req, res) => {
      const query = req.query as Record<string, unknown>;
      const clientId = stringParam(query.client_id);
      if (!clientId) {
        throw new OAuthProtocolError("invalid_request", "client_id is required");
      }
      const client = await resolveAuthorizeClient(clientId, metadataDocuments);
      // RFC 6749 §4.1.2.1: never redirect to an unverified URI, so these two fail in place.
      const requestedRedirect = stringParam(query.redirect_uri);
      const redirectUri =
        requestedRedirect ??
        (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
      if (!redirectUri || !redirectUriMatchesRegistered(redirectUri, client.redirectUris)) {
        throw new OAuthProtocolError(
          "invalid_request",
          "redirect_uri does not match a registered redirect URI"
        );
      }

      const state = stringParam(query.state);
      const redirectError = (error: string, description: string): void => {
        res.redirect(
          302,
          appendParams(redirectUri, {
            error,
            error_description: description,
            iss: oauth.issuer,
            state,
          })
        );
      };

      if (query.response_type !== "code") {
        redirectError("unsupported_response_type", "response_type must be code");
        return;
      }
      const codeChallenge = stringParam(query.code_challenge);
      if (!codeChallenge || !CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
        redirectError("invalid_request", "A PKCE S256 code_challenge is required");
        return;
      }
      if (query.code_challenge_method !== "S256") {
        redirectError("invalid_request", "code_challenge_method must be S256");
        return;
      }
      const resource = stringParam(query.resource);
      if (resource && normalizeResource(resource) !== normalizeResource(oauth.resource)) {
        redirectError("invalid_target", `resource must be ${oauth.resource}`);
        return;
      }
      let scope: string;
      try {
        scope = parseScope(stringParam(query.scope), oauth.scopesSupported);
      } catch (error) {
        redirectError("invalid_scope", (error as Error).message);
        return;
      }

      const requestId = generateMcpOAuthSecret();
      await McpOAuthAuthorization.create({
        clientId,
        codeChallenge,
        expiresAt: DateTime.now().plus({seconds: oauth.authorizationRequestTtlSeconds}).toJSDate(),
        redirectUri,
        requestId,
        resource: resource ?? oauth.resource,
        scope,
        state,
        status: "pending",
      });
      res.redirect(
        302,
        oauth.consent.mode === "builtin" || !oauth.consentUrl
          ? `${oauth.issuer}/oauth/consent/${encodeURIComponent(requestId)}`
          : appendParams(oauth.consentUrl, {request: requestId})
      );
    })
  );
};

const addConsentRoutes = (
  app: Application,
  oauth: ResolvedMcpOAuthOptions,
  openApi: OpenApiMiddleware | undefined,
  betterAuth: BetterAuthInstance | undefined
): void => {
  const openApiOptions = {openApi};

  app.get(
    "/oauth/authorize/:request",
    [
      ...consentGuards,
      createOpenApiBuilder(openApiOptions)
        .withTags(["mcp"])
        .withOperationId("getMcpOAuthRequest")
        .withSummary("Read a pending MCP OAuth authorization request")
        .withDescription(
          "Returns what the consent screen shows: the client, where the code goes, and the scope."
        )
        .withPathParameter("request", {type: "string"})
        .withResponse(200, {
          data: {
            properties: {
              clientId: {type: "string"},
              clientName: {type: "string"},
              expiresAt: {type: "string"},
              grants: {
                items: {
                  properties: {
                    access: {enum: ["read", "write"], type: "string"},
                    description: {nullable: true, type: "string"},
                    label: {type: "string"},
                    scope: {type: "string"},
                  },
                  type: "object",
                },
                type: "array",
              },
              redirectHost: {type: "string"},
              redirectUri: {type: "string"},
              requestId: {type: "string"},
              resource: {type: "string"},
              scope: {type: "string"},
            },
            type: "object",
          },
        })
        .build(),
    ],
    asyncHandler(async (req, res) => {
      requireUser(req);
      const authorization = await loadPendingAuthorization(String(req.params.request));
      const client = await loadActiveClient(authorization.clientId);
      return res.json({
        data: {
          clientId: authorization.clientId,
          clientName: client.clientName ?? null,
          expiresAt: authorization.expiresAt.toISOString(),
          grants: consentGrantsFor(authorization.scope, oauth.grants),
          redirectHost: new URL(authorization.redirectUri).host,
          redirectUri: authorization.redirectUri,
          requestId: authorization.requestId,
          resource: authorization.resource ?? oauth.resource,
          scope: authorization.scope ?? null,
        },
      });
    })
  );

  const decisionOpenApiBuilder = (
    operationId: string,
    summary: string
  ): ReturnType<typeof createOpenApiBuilder> =>
    createOpenApiBuilder(openApiOptions)
      .withTags(["mcp"])
      .withOperationId(operationId)
      .withSummary(summary)
      .withDescription(
        "Called by the app's consent screen with the signed-in user's JWT. Returns the URL to send the browser to."
      )
      .withPathParameter("request", {type: "string"})
      .withResponse(200, {
        data: {
          properties: {redirectUrl: {type: "string"}},
          type: "object",
        },
      });

  const decisionOpenApi = (operationId: string, summary: string): RequestHandler =>
    decisionOpenApiBuilder(operationId, summary).build();

  app.post(
    "/oauth/authorize/:request/approve",
    [
      createRouteRateLimitMiddleware({name: "mcp-oauth-approve", ...MCP_OAUTH_APPROVE_RATE_LIMIT}),
      ...consentGuards,
      decisionOpenApiBuilder("approveMcpOAuthRequest", "Approve a pending MCP OAuth request")
        .withRequestBody<{scope: string}>(
          {
            scope: {
              description:
                "Space-separated subset of the requested scope the user approved. Omit to approve the full requested scope.",
              type: "string",
            },
          },
          {required: false}
        )
        .build(),
    ],
    asyncHandler(async (req, res) => {
      const user = requireUser(req);
      // Builtin mode asks for a password and code on every approval; a session must not skip it.
      if (oauth.consent.mode === "builtin") {
        throw new ForbiddenError({
          code: "mcp-oauth-builtin-consent",
          title: "Approve on the built-in consent page",
        });
      }
      const pending = await loadPendingAuthorization(String(req.params.request));
      const scope = approvedScope(req.body, pending.scope);
      const problem = await approvalPolicyProblem(user, oauth, betterAuth);
      if (problem) {
        throw new ForbiddenError({code: "mcp-oauth-approver-not-allowed", title: problem});
      }
      const redirectUrl = await approveAuthorization({oauth, pending, scope, user});
      return res.json({data: {redirectUrl}});
    })
  );

  app.post(
    "/oauth/authorize/:request/deny",
    [...consentGuards, decisionOpenApi("denyMcpOAuthRequest", "Deny a pending MCP OAuth request")],
    asyncHandler(async (req, res) => {
      const user = requireUser(req);
      const pending = await loadPendingAuthorization(String(req.params.request));
      const redirectUrl = await denyAuthorization({oauth, pending, userId: String(user._id)});
      return res.json({data: {redirectUrl}});
    })
  );
};

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
  token_type: "Bearer";
}

/**
 * A revoke can land after the token route has loaded the client and before this pair exists.
 * A new family has no tombstone yet, so drop the pair when the client is already revoked.
 */
const discardIssuedIfClientRevoked = async (clientId: string, familyId: string): Promise<void> => {
  const current = await McpOAuthClient.findOneOrNone({clientId});
  if (!current || current.revokedAt) {
    await McpOAuthToken.revokeFamily(familyId);
    throw new OAuthProtocolError("invalid_client", "Unknown client_id", 401);
  }
};

const exchangeAuthorizationCode = async (
  body: Record<string, unknown>,
  clientId: string,
  oauth: ResolvedMcpOAuthOptions,
  userModel: UserModel
): Promise<TokenResponse> => {
  const code = stringParam(body.code);
  const redirectUri = stringParam(body.redirect_uri);
  const codeVerifier = stringParam(body.code_verifier);
  if (!code || !redirectUri || !codeVerifier) {
    throw new OAuthProtocolError(
      "invalid_request",
      "code, redirect_uri, and code_verifier are required"
    );
  }
  const codeHash = hashMcpOAuthSecret(code);
  const now = DateTime.now();
  // Consume the code before checking it, so a failed attempt (wrong verifier) burns it too.
  // The family id is fixed here so a replay can revoke it before the tokens exist.
  const consumed = await McpOAuthAuthorization.findOneAndUpdate(
    {codeHash, status: "approved"},
    {
      $set: {
        expiresAt: now.plus({seconds: USED_CODE_RETENTION_SECONDS}).toJSDate(),
        familyId: randomUUID(),
        status: "used",
        usedAt: now.toJSDate(),
      },
    },
    {returnDocument: "after"}
  );
  if (!consumed) {
    const replayed = await McpOAuthAuthorization.findOneOrNone({codeHash});
    if (replayed?.status === "used" && replayed.familyId) {
      // RFC 6749 §4.1.2: a replayed code revokes the tokens it already issued.
      logger.warn("[MCPOAuth] Authorization code replayed, revoking its tokens", {
        clientId: replayed.clientId,
      });
      await McpOAuthToken.revokeFamily(replayed.familyId);
    }
    throw new OAuthProtocolError("invalid_grant", "Authorization code is invalid or already used");
  }
  if (!consumed.codeExpiresAt || DateTime.fromJSDate(consumed.codeExpiresAt) <= now) {
    throw new OAuthProtocolError("invalid_grant", "Authorization code expired");
  }
  if (consumed.clientId !== clientId || consumed.redirectUri !== redirectUri) {
    throw new OAuthProtocolError(
      "invalid_grant",
      "Authorization code was issued to another client or redirect_uri"
    );
  }
  if (
    !CODE_VERIFIER_PATTERN.test(codeVerifier) ||
    pkceS256(codeVerifier) !== consumed.codeChallenge
  ) {
    throw new OAuthProtocolError(
      "invalid_grant",
      "code_verifier does not match the code_challenge"
    );
  }
  const user = consumed.userId ? await userModel.findById(consumed.userId) : null;
  if (!user || userIsDisabled(user)) {
    throw new OAuthProtocolError("invalid_grant", "The authorizing user is not active");
  }
  if (isCredentialEpochStale(consumed.tokenEpoch, user)) {
    throw new OAuthProtocolError(
      "invalid_grant",
      "The authorizing user's credentials changed after approval"
    );
  }

  const issued = await issueOrInvalidGrant({
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    clientId,
    familyId: consumed.familyId,
    refreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
    resource: consumed.resource,
    scope: consumed.scope,
    tokenEpoch: userTokenEpoch(user),
    userId: consumed.userId as mongoose.Types.ObjectId,
  });
  if (!issued.refreshToken) {
    throw new OAuthProtocolError("server_error", "Expected a refresh token", 500);
  }
  await discardIssuedIfClientRevoked(clientId, issued.mcpOAuthToken.familyId);
  return {
    access_token: issued.accessToken,
    expires_in: oauth.accessTokenTtlSeconds,
    refresh_token: issued.refreshToken,
    scope: consumed.scope,
    token_type: "Bearer",
  };
};

const exchangeRefreshToken = async (
  body: Record<string, unknown>,
  clientId: string,
  oauth: ResolvedMcpOAuthOptions,
  userModel: UserModel
): Promise<TokenResponse> => {
  const refreshToken = stringParam(body.refresh_token);
  if (!refreshToken) {
    throw new OAuthProtocolError("invalid_request", "refresh_token is required");
  }
  const refreshTokenHash = hashMcpOAuthSecret(refreshToken);
  const current = await McpOAuthToken.findOneOrNone({refreshTokenHash});
  if (!current || current.clientId !== clientId || current.hasRefreshToken === false) {
    throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid");
  }
  const now = DateTime.now();
  // Rotate atomically: only one exchange of a refresh token can win. The pre-rotate document
  // tells this request whether it won, independent of what the earlier lookup saw.
  const rotated = await McpOAuthToken.findOneAndUpdate(
    {_id: current._id, rotatedAt: {$exists: false}},
    {$min: {revokedAt: now.toJSDate()}, $set: {rotatedAt: now.toJSDate()}},
    {returnDocument: "before"}
  );
  if (!rotated) {
    // A rotated refresh token came back: someone holds a copy. Kill the whole chain.
    logger.warn("[MCPOAuth] Refresh token reused, revoking its chain", {
      clientId,
      userId: String(current.userId),
    });
    await McpOAuthToken.revokeFamily(current.familyId);
    throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid, expired, or revoked");
  }
  if (rotated.revokedAt || DateTime.fromJSDate(rotated.refreshExpiresAt) <= now) {
    throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid, expired, or revoked");
  }
  const user = await userModel.findById(rotated.userId);
  if (!user || userIsDisabled(user)) {
    await McpOAuthToken.revokeFamily(rotated.familyId);
    throw new OAuthProtocolError("invalid_grant", "The authorizing user is not active");
  }
  if (isCredentialEpochStale(rotated.tokenEpoch, user)) {
    // A password reset or session revocation ends every grant approved before it.
    await McpOAuthToken.revokeFamily(rotated.familyId);
    throw new OAuthProtocolError(
      "invalid_grant",
      "The authorizing user's credentials changed after approval"
    );
  }
  const issued = await issueOrInvalidGrant({
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    clientId,
    familyId: rotated.familyId,
    refreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
    resource: rotated.resource,
    scope: rotated.scope,
    tokenEpoch: userTokenEpoch(user),
    userId: rotated.userId,
  });
  if (!issued.refreshToken) {
    throw new OAuthProtocolError("server_error", "Expected a refresh token", 500);
  }
  await discardIssuedIfClientRevoked(clientId, issued.mcpOAuthToken.familyId);
  return {
    access_token: issued.accessToken,
    expires_in: oauth.accessTokenTtlSeconds,
    refresh_token: issued.refreshToken,
    scope: rotated.scope,
    token_type: "Bearer",
  };
};

interface BasicClientCredentials {
  clientId?: string;
  clientSecret?: string;
}

/** RFC 6749 §2.3.1 HTTP Basic client authentication. The id and secret are form-encoded. */
const readBasicClient = (authorization: string | undefined): BasicClientCredentials => {
  if (!authorization?.startsWith("Basic ")) {
    return {};
  }
  const decoded = Buffer.from(authorization.slice("Basic ".length).trim(), "base64").toString(
    "utf8"
  );
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return {};
  }
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return {};
  }
};

const clientSecretMatches = (
  client: McpOAuthClientDocument,
  presented: string | undefined
): boolean => {
  if (!presented || !client.clientSecretHash) {
    return false;
  }
  const actual = Buffer.from(client.clientSecretHash);
  const expected = Buffer.from(hashMcpOAuthSecret(presented));
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
};

const assertClientAuthenticated = (
  client: McpOAuthClientDocument,
  body: Record<string, unknown>,
  basic: BasicClientCredentials
): void => {
  const method = client.tokenEndpointAuthMethod ?? "none";
  if (method === "none") {
    throw new OAuthProtocolError("invalid_client", "Client authentication failed", 401);
  }
  const presented =
    method === "client_secret_basic"
      ? basic.clientId === client.clientId
        ? basic.clientSecret
        : undefined
      : stringParam(body.client_id) === client.clientId
        ? stringParam(body.client_secret)
        : undefined;
  const usedOtherMethod =
    method === "client_secret_basic"
      ? Boolean(stringParam(body.client_secret))
      : Boolean(basic.clientSecret);
  if (usedOtherMethod || !clientSecretMatches(client, presented)) {
    throw new OAuthProtocolError("invalid_client", "Client authentication failed", 401);
  }
};

const exchangeClientCredentials = async (
  body: Record<string, unknown>,
  client: McpOAuthClientDocument,
  oauth: ResolvedMcpOAuthOptions,
  userModel: UserModel
): Promise<Record<string, unknown>> => {
  if (!client.userId || (client.tokenEndpointAuthMethod ?? "none") === "none") {
    throw new OAuthProtocolError("invalid_client", "Client authentication failed", 401);
  }
  const user = await userModel.findById(client.userId);
  if (!user || userIsDisabled(user)) {
    throw new OAuthProtocolError("invalid_grant", "The user cannot be granted a token");
  }
  // A client stored before the app switched to grants may hold scopes the server no longer
  // supports; only the supported ones can be issued.
  const allowed = client.scope
    ? splitScope(client.scope).filter((value) => oauth.scopesSupported.includes(value))
    : oauth.scopesSupported;
  if (allowed.length === 0) {
    throw new OAuthProtocolError(
      "invalid_scope",
      "The client's scope has no scope this server supports"
    );
  }
  const scope = parseScope(stringParam(body.scope), allowed);
  const issued = await issueOrInvalidGrant({
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    clientId: client.clientId,
    includeRefreshToken: false,
    refreshTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    resource: oauth.resource,
    scope,
    tokenEpoch: userTokenEpoch(user),
    userId: client.userId,
  });
  await discardIssuedIfClientRevoked(client.clientId, issued.mcpOAuthToken.familyId);
  return {
    access_token: issued.accessToken,
    expires_in: oauth.accessTokenTtlSeconds,
    scope,
    token_type: "Bearer",
  };
};

const addTokenRoutes = (
  app: Application,
  oauth: ResolvedMcpOAuthOptions,
  userModel: UserModel
): void => {
  app.post(
    "/oauth/token",
    oauthHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const basic = readBasicClient(
        typeof req.headers.authorization === "string" ? req.headers.authorization : undefined
      );
      const clientId = stringParam(body.client_id) ?? basic.clientId;
      if (!clientId) {
        throw new OAuthProtocolError("invalid_client", "client_id is required", 401);
      }
      const client = await McpOAuthClient.findOneOrNone({clientId});
      if (!client || client.revokedAt) {
        throw new OAuthProtocolError("invalid_client", "Unknown client_id", 401);
      }
      const grantType = stringParam(body.grant_type);
      if (!grantType || !client.grantTypes.includes(grantType)) {
        throw new OAuthProtocolError(
          "unsupported_grant_type",
          "grant_type is not allowed for this client"
        );
      }
      if (
        grantType === "client_credentials" ||
        (client.tokenEndpointAuthMethod && client.tokenEndpointAuthMethod !== "none")
      ) {
        assertClientAuthenticated(client, body, basic);
      }
      const tokens =
        grantType === "client_credentials"
          ? await exchangeClientCredentials(body, client, oauth, userModel)
          : grantType === "authorization_code"
            ? await exchangeAuthorizationCode(body, clientId, oauth, userModel)
            : await exchangeRefreshToken(body, clientId, oauth, userModel);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      sendProtocolJson(res, 200, tokens);
    })
  );

  app.post(
    "/oauth/revoke",
    oauthHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = stringParam(body.token);
      if (!token) {
        throw new OAuthProtocolError("invalid_request", "token is required");
      }
      const tokenHash = hashMcpOAuthSecret(token);
      const issued = await McpOAuthToken.findOneOrNone({
        $or: [{accessTokenHash: tokenHash}, {refreshTokenHash: tokenHash}],
      });
      const clientId = stringParam(body.client_id);
      // RFC 7009 §2.2: unknown tokens and another client's tokens still get a 200.
      if (issued && (!clientId || issued.clientId === clientId)) {
        if (issued.refreshTokenHash === tokenHash) {
          await McpOAuthToken.revokeFamily(issued.familyId);
        } else {
          await McpOAuthToken.updateOne(
            {_id: issued._id, revokedAt: {$exists: false}},
            {$set: {revokedAt: DateTime.now().toJSDate()}}
          );
        }
      }
      res.setHeader("Cache-Control", "no-store");
      sendProtocolJson(res, 200, {});
    })
  );
};

/**
 * Mount the MCP OAuth authorization server: discovery documents, client registration (only with
 * `dynamicClientRegistration`), authorize + consent decision, token, and revocation endpoints.
 */
export const addMcpOAuthRoutes = (app: Application, options: McpOAuthRoutesOptions): void => {
  const {betterAuth, oauth, openApi, userModel} = options;
  addDiscoveryRoutes(app, oauth);
  if (oauth.dynamicClientRegistration) {
    addRegistrationRoute(app, oauth);
  }
  const metadataDocuments = oauth.clientIdMetadataDocuments
    ? createClientMetadataDocumentResolver(oauth.clientIdMetadataDocuments)
    : undefined;
  addAuthorizeRoute(app, oauth, metadataDocuments);
  addConsentRoutes(app, oauth, openApi, betterAuth);
  addTokenRoutes(app, oauth, userModel);
};
