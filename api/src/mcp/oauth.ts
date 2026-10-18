/**
 * Terreno-native OAuth 2.1 authorization server for `/mcp`, for apps that authenticate with
 * Terreno JWTs. Remote MCP clients (Claude.ai connectors, ChatGPT apps) discover it through
 * RFC 9728 / RFC 8414 metadata, register with RFC 7591 dynamic client registration, and run the
 * authorization-code flow with PKCE S256. Terreno is backend-only, so the app hosts the consent
 * screen at `consentUrl` and calls the approve/deny endpoints with the signed-in user's JWT.
 */
import {createHash, randomUUID} from "node:crypto";
import type {Application, NextFunction, Request, RequestHandler, Response} from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {asyncHandler, type OpenApiMiddleware} from "../api";
import {authenticateMiddleware, type User, type UserModel} from "../auth";
import {BadRequestError, ConflictError, NotFoundError, UnauthorizedError} from "../errors";
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
import type {
  McpOAuthAuthorizationDocument,
  McpOAuthTokenIssueOptions,
  McpOAuthTokenModel,
} from "../types/mcpOAuth";
import {bearerFromHeaders} from "./auth";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  LOOPBACK_HOSTS,
  protectedResourceMetadataPath,
  type ResolvedMcpOAuthOptions,
  SUPPORTED_GRANT_TYPES,
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

const requireUser = (req: Request): User => {
  const user = req.user as unknown as User | undefined;
  if (!user?._id) {
    throw new UnauthorizedError("Unauthorized");
  }
  return user;
};

/** Load a pending request for the consent endpoints, or explain why it cannot be decided. */
const loadPendingAuthorization = async (
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
      const grantTypes = (body.grant_types as unknown[] | undefined) ?? SUPPORTED_GRANT_TYPES;
      if (
        !Array.isArray(grantTypes) ||
        !grantTypes.includes("authorization_code") ||
        grantTypes.some((grant) => !SUPPORTED_GRANT_TYPES.includes(grant as string))
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

const addAuthorizeRoute = (app: Application, oauth: ResolvedMcpOAuthOptions): void => {
  app.get(
    "/oauth/authorize",
    oauthHandler(async (req, res) => {
      const query = req.query as Record<string, unknown>;
      const clientId = stringParam(query.client_id);
      if (!clientId) {
        throw new OAuthProtocolError("invalid_request", "client_id is required");
      }
      const client = await McpOAuthClient.findOneOrNone({clientId});
      if (!client) {
        throw new OAuthProtocolError("invalid_request", "Unknown client_id");
      }
      // RFC 6749 §4.1.2.1: never redirect to an unverified URI, so these two fail in place.
      const requestedRedirect = stringParam(query.redirect_uri);
      const redirectUri =
        requestedRedirect ??
        (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
      if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
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
      res.redirect(302, appendParams(oauth.consentUrl, {request: requestId}));
    })
  );
};

const addConsentRoutes = (
  app: Application,
  oauth: ResolvedMcpOAuthOptions,
  openApi?: OpenApiMiddleware
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
      const client = await McpOAuthClient.findOneOrNone({clientId: authorization.clientId});
      return res.json({
        data: {
          clientId: authorization.clientId,
          clientName: client?.clientName ?? null,
          expiresAt: authorization.expiresAt.toISOString(),
          redirectHost: new URL(authorization.redirectUri).host,
          redirectUri: authorization.redirectUri,
          requestId: authorization.requestId,
          resource: authorization.resource ?? oauth.resource,
          scope: authorization.scope ?? null,
        },
      });
    })
  );

  const decisionOpenApi = (operationId: string, summary: string): RequestHandler =>
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
      })
      .build();

  app.post(
    "/oauth/authorize/:request/approve",
    [
      ...consentGuards,
      decisionOpenApi("approveMcpOAuthRequest", "Approve a pending MCP OAuth request"),
    ],
    asyncHandler(async (req, res) => {
      const user = requireUser(req);
      const pending = await loadPendingAuthorization(String(req.params.request));
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
            status: "approved",
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
      return res.json({
        data: {
          redirectUrl: appendParams(approved.redirectUri, {
            code,
            iss: oauth.issuer,
            state: approved.state,
          }),
        },
      });
    })
  );

  app.post(
    "/oauth/authorize/:request/deny",
    [...consentGuards, decisionOpenApi("denyMcpOAuthRequest", "Deny a pending MCP OAuth request")],
    asyncHandler(async (req, res) => {
      const user = requireUser(req);
      const pending = await loadPendingAuthorization(String(req.params.request));
      const denied = await McpOAuthAuthorization.findOneAndUpdate(
        {_id: pending._id, status: "pending"},
        {
          $set: {
            status: "denied",
            userId: new mongoose.Types.ObjectId(String(user._id)),
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
      return res.json({
        data: {
          redirectUrl: appendParams(denied.redirectUri, {
            error: "access_denied",
            error_description: "The user denied the request",
            iss: oauth.issuer,
            state: denied.state,
          }),
        },
      });
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

  const issued = await issueOrInvalidGrant({
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    clientId,
    familyId: consumed.familyId,
    refreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
    resource: consumed.resource,
    scope: consumed.scope,
    userId: consumed.userId as mongoose.Types.ObjectId,
  });
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
  if (!current || current.clientId !== clientId) {
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
  const issued = await issueOrInvalidGrant({
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    clientId,
    familyId: rotated.familyId,
    refreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
    resource: rotated.resource,
    scope: rotated.scope,
    userId: rotated.userId,
  });
  return {
    access_token: issued.accessToken,
    expires_in: oauth.accessTokenTtlSeconds,
    refresh_token: issued.refreshToken,
    scope: rotated.scope,
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
      const clientId = stringParam(body.client_id);
      if (!clientId) {
        throw new OAuthProtocolError("invalid_client", "client_id is required", 401);
      }
      const client = await McpOAuthClient.findOneOrNone({clientId});
      if (!client) {
        throw new OAuthProtocolError("invalid_client", "Unknown client_id", 401);
      }
      const grantType = stringParam(body.grant_type);
      if (!grantType || !client.grantTypes.includes(grantType)) {
        throw new OAuthProtocolError(
          "unsupported_grant_type",
          "grant_type must be authorization_code or refresh_token"
        );
      }
      const tokens =
        grantType === "authorization_code"
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
  const {oauth, openApi, userModel} = options;
  addDiscoveryRoutes(app, oauth);
  if (oauth.dynamicClientRegistration) {
    addRegistrationRoute(app, oauth);
  }
  addAuthorizeRoute(app, oauth);
  addConsentRoutes(app, oauth, openApi);
  addTokenRoutes(app, oauth, userModel);
};
