import jwt from "jsonwebtoken";
import {DateTime} from "luxon";

import type {User, UserModel} from "../auth";
import type {BetterAuthInstance} from "../betterAuthSetup";
import {logger} from "../logger";
import {MCP_OAUTH_ACCESS_TOKEN_PREFIX, McpOAuthToken} from "../models/mcpOAuthToken";
import {MCP_SERVICE_TOKEN_PREFIX, McpServiceToken} from "../models/mcpServiceToken";
import {findOneOrNoneFor} from "../plugins";
import type {RequestCredential} from "../requestContext";

export interface MCPAuthContext {
  userModel: UserModel;
  betterAuth?: BetterAuthInstance;
  mcpServiceTokens?: boolean;
  /** Accept `mcpat_` OAuth access tokens issued by the MCP OAuth server. */
  mcpOAuth?: boolean;
}

/** The authenticated user plus the credential type that proved it. */
export interface MCPAuthResult {
  credential: RequestCredential;
  /** Scopes granted to an MCP OAuth access token; unset for other credentials. */
  scopes?: string[];
  user: User;
}

/**
 * Reject a disabled account the way the JWT middleware's 401 does. Without this an MCP
 * client could keep calling tools with a still-valid token or session after the account
 * was disabled, which REST already refuses.
 */
const rejectIfDisabled = (user: User | undefined, source: string): User | undefined => {
  if (!user) {
    return undefined;
  }
  if ((user as {disabled?: boolean}).disabled) {
    logger.warn(`[mcp] User ${user.id} is disabled, rejecting ${source} credentials`);
    return undefined;
  }
  return user;
};

/** The user's credential generation; a password reset or session revocation increments it. */
export const userTokenEpoch = (user: unknown): number => {
  const tokenEpoch = (user as {tokenEpoch?: unknown} | null | undefined)?.tokenEpoch;
  return typeof tokenEpoch === "number" ? tokenEpoch : 0;
};

/**
 * True when a credential minted under `issuedEpoch` predates the user's current tokenEpoch.
 * A credential stored before the field existed counts as epoch 0, as a refresh token without
 * `te` does.
 */
export const isCredentialEpochStale = (issuedEpoch: number | undefined, user: unknown): boolean =>
  (issuedEpoch ?? 0) !== userTokenEpoch(user);

export const bearerFromHeaders = (
  headers: Record<string, string | string[] | undefined>
): {authorization?: string; token?: string} => {
  const authorization =
    typeof headers.authorization === "string"
      ? headers.authorization
      : Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : undefined;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : authorization;
  return {authorization, token};
};

const authenticateServiceToken = async (
  token: string,
  userModel: UserModel
): Promise<MCPAuthResult | undefined> => {
  const serviceToken = await McpServiceToken.verify(token);
  if (!serviceToken) {
    return undefined;
  }
  const user = await userModel.findById(serviceToken.userId);
  const activeUser = rejectIfDisabled(user as unknown as User | undefined, "MCP service token");
  if (!activeUser) {
    return undefined;
  }
  if (isCredentialEpochStale(serviceToken.tokenEpoch, activeUser)) {
    logger.warn(
      `[mcp] Revoking an MCP service token issued before user ${activeUser.id}'s credentials changed`
    );
    await McpServiceToken.updateOne(
      {_id: serviceToken._id, revokedAt: {$exists: false}},
      {$set: {revokedAt: DateTime.now().toJSDate()}}
    );
    return undefined;
  }
  void McpServiceToken.updateOne(
    {_id: serviceToken._id},
    {$set: {lastUsedAt: DateTime.now().toJSDate()}}
  ).catch((error) => {
    logger.debug(`MCP service token last-used update failed: ${error}`);
  });
  return {credential: "mcp-service-token", user: activeUser};
};

const authenticateOAuthAccessToken = async (
  token: string,
  userModel: UserModel
): Promise<MCPAuthResult | undefined> => {
  const accessToken = await McpOAuthToken.verifyAccessToken(token);
  if (!accessToken) {
    return undefined;
  }
  const user = await userModel.findById(accessToken.userId);
  const activeUser = rejectIfDisabled(user as unknown as User | undefined, "MCP OAuth");
  if (!activeUser) {
    return undefined;
  }
  if (isCredentialEpochStale(accessToken.tokenEpoch, activeUser)) {
    logger.warn(
      `[mcp] Revoking an MCP OAuth grant issued before user ${activeUser.id}'s credentials changed`
    );
    await McpOAuthToken.revokeFamily(accessToken.familyId);
    return undefined;
  }
  const scopes = (accessToken.scope ?? "").split(" ").filter((scope) => scope.length > 0);
  return {credential: "oauth", scopes, user: activeUser};
};

/**
 * Resolve the caller and the credential type from raw headers using whichever auth providers
 * are configured, mirroring authenticateMiddleware behavior: `mcp_` service tokens and `mcpat_`
 * OAuth access tokens first (each is a distinct credential type), then a Better Auth session,
 * then a Terreno JWT.
 */
export const extractAuthFromHeaders = async (
  headers: Record<string, string | string[] | undefined>,
  context: MCPAuthContext
): Promise<MCPAuthResult | undefined> => {
  const {userModel, betterAuth, mcpServiceTokens, mcpOAuth} = context;
  const {authorization, token} = bearerFromHeaders(headers);

  if (mcpServiceTokens && token?.startsWith(MCP_SERVICE_TOKEN_PREFIX)) {
    return authenticateServiceToken(token, userModel);
  }

  if (mcpOAuth && token?.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX)) {
    return authenticateOAuthAccessToken(token, userModel);
  }

  if (betterAuth) {
    try {
      const session = await betterAuth.api.getSession({
        headers: headers as Record<string, string>,
      });

      if (session?.user && session?.session) {
        // betterAuthId is unique per user — findById-like lookup that may return null.
        // findOneOrNoneFor keeps the repo's "never call findOne directly" convention while
        // working whether or not the consumer's model has the findOneOrNone plugin applied.
        const appUser = await findOneOrNoneFor(userModel, {betterAuthId: session.user.id});
        if (appUser) {
          const activeUser = rejectIfDisabled(appUser as unknown as User, "Better Auth");
          return activeUser ? {credential: "better-auth-session", user: activeUser} : undefined;
        }
      }
    } catch (error) {
      logger.debug(`MCP Better Auth session extraction failed: ${error}`);
    }
  }

  if (!authorization || !token) {
    return undefined;
  }

  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    logger.warn("TOKEN_SECRET not set, cannot verify JWT for MCP request");
    return undefined;
  }

  try {
    const decoded = jwt.verify(token, tokenSecret, {
      issuer: process.env.TOKEN_ISSUER,
    }) as jwt.JwtPayload;

    const userId = decoded.id || decoded.sub;
    if (!userId) {
      return undefined;
    }

    const user = await userModel.findById(userId);
    const activeUser = rejectIfDisabled(user as unknown as User | undefined, "JWT");
    return activeUser ? {credential: "jwt", user: activeUser} : undefined;
  } catch (error) {
    logger.debug(`MCP JWT verification failed: ${error}`);
    return undefined;
  }
};

/**
 * Extract user from raw headers using whichever auth provider is configured.
 * Works with both JWT and Better Auth, mirroring authenticateMiddleware behavior.
 * Use {@link extractAuthFromHeaders} when the credential type matters.
 */
export const extractUserFromHeaders = async (
  headers: Record<string, string | string[] | undefined>,
  context: MCPAuthContext
): Promise<User | undefined> => {
  return (await extractAuthFromHeaders(headers, context))?.user;
};
