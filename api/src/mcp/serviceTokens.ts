import type {Application, NextFunction, Request, Response} from "express";
import {DateTime} from "luxon";
import type {Document} from "mongoose";

import {
  type ModelRouterOptions,
  type ModelRouterRegistration,
  modelRouter,
  type OpenApiMiddleware,
  type RESTMethod,
} from "../api";
import type {User} from "../auth";
import {BadRequestError, NotFoundError, UnauthorizedError} from "../errors";
import {McpServiceToken} from "../models/mcpServiceToken";
import {Permissions} from "../permissions";
import {defaultResponseHandler} from "../transformers";
import type {McpServiceTokenDocument} from "../types/mcpServiceToken";
import {z} from "../zodOpenApi";

export const MAX_ACTIVE_MCP_SERVICE_TOKENS = 10;

/** Route path of the self-serve MCP service token router. */
export const MCP_SERVICE_TOKENS_ROUTE_PATH = "/mcp/service-tokens";

/** Sync collection tag clients subscribe to (`mcp/service-tokens|owner:{userId}`). */
export const MCP_SERVICE_TOKENS_SYNC_COLLECTION = "mcp/service-tokens";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 100;
const ACTION_TAG = "mcpServiceTokens";

export interface McpServiceTokenRoutesOptions {
  openApi?: OpenApiMiddleware;
  publicMcpUrl?: string;
}

export type McpServiceTokensAppOption =
  | boolean
  | {
      enabled: boolean;
      publicMcpUrl?: string;
    };

export const resolveMcpServiceTokensOption = (
  option: McpServiceTokensAppOption | undefined
): {enabled: boolean; publicMcpUrl?: string} => {
  if (option === true) {
    return {enabled: true};
  }
  if (option && typeof option === "object" && option.enabled === true) {
    return {enabled: true, publicMcpUrl: option.publicMcpUrl};
  }
  return {enabled: false};
};

const bearerFromRequest = (req: Request): string | undefined => {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") {
    return undefined;
  }
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  return authorization;
};

const rejectMcpServiceTokenBearer = (req: Request, _res: Response, next: NextFunction): void => {
  const token = bearerFromRequest(req);
  if (token?.startsWith("mcp_")) {
    next(new UnauthorizedError("MCP service tokens cannot manage service tokens"));
    return;
  }
  next();
};

const requireAuthenticatedUser = (user: User | undefined): User => {
  if (!user?._id) {
    throw new UnauthorizedError("Unauthorized");
  }
  return user;
};

const parseName = (value: string): string => {
  const name = value.trim();
  if (!name) {
    throw new BadRequestError({title: "name is required"});
  }
  return name;
};

const parseExpiresAt = (value: string | null | undefined): Date | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = DateTime.fromISO(value, {setZone: true});
  if (!parsed.isValid) {
    throw new BadRequestError({title: "expiresAt must be an ISO-8601 datetime string"});
  }
  if (parsed.toMillis() <= DateTime.now().toMillis()) {
    throw new BadRequestError({title: "expiresAt must be in the future"});
  }
  return parsed.toUTC().toJSDate();
};

const resolveMcpUrl = (req: Request, publicMcpUrl?: string): string => {
  const configured = publicMcpUrl ?? process.env.BETTER_AUTH_URL;
  if (configured) {
    const base = configured.replace(/\/$/, "");
    if (base.endsWith("/mcp")) {
      return base;
    }
    return `${base}/mcp`;
  }
  const host = req.get("host") ?? "localhost";
  return `${req.protocol}://${host}/mcp`;
};

/**
 * Public shape of a stored MCP service token: every field except `tokenHash`, plus `id`.
 * Used for REST responses, sync snapshots, and sync deltas so the hash never leaves the server.
 */
export const toPublicMcpServiceToken = (doc: Record<string, unknown>): Record<string, unknown> => {
  const {tokenHash: _tokenHash, ...rest} = doc;
  return {...rest, id: String(doc._id)};
};

const stripTokenHash = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripTokenHash);
  }
  if (value && typeof value === "object") {
    const {tokenHash: _tokenHash, ...rest} = value as Record<string, unknown>;
    return rest;
  }
  return value;
};

const mcpServiceTokenResponseHandler = async (
  value: Document | Document[],
  method: "list" | "create" | "read" | "update" | "delete",
  req: Request,
  options: ModelRouterOptions<McpServiceTokenDocument>
): Promise<never> => {
  const serialized = await defaultResponseHandler(
    value as never,
    method as "list" | "create" | "read" | "update",
    req,
    options
  );
  return stripTokenHash(serialized) as never;
};

/** Read access is owner-only (no admin bypass: admins use the admin panel). */
const isTokenOwner = (_method: RESTMethod, user?: User, obj?: unknown): boolean => {
  if (!user?.id) {
    return false;
  }
  if (!obj) {
    return true;
  }
  return String((obj as {userId?: unknown}).userId) === String(user.id);
};

const createBody = z.object({
  expiresAt: z
    .string()
    .nullable()
    .optional()
    .describe("Optional ISO-8601 expiry; omit for a token that does not expire"),
  name: z.string().describe("User-visible label for this token"),
});

const createdTokenResponse = z.object({
  created: z.string(),
  expiresAt: z.string().nullable(),
  id: z.string(),
  mcpUrl: z.string(),
  name: z.string(),
  token: z.string().describe("The plaintext mcp_ token. Returned only by this response."),
  tokenPrefix: z.string(),
});

/**
 * Build the self-serve `/mcp/service-tokens` router. The collection is synced read-only
 * (owner scope on `userId`): list/read over REST and sync, no client create/update/delete.
 * Minting and revoking are the `create` collection action and `revoke` instance action.
 */
export const createMcpServiceTokenRouter = (
  options: McpServiceTokenRoutesOptions = {}
): ModelRouterRegistration =>
  modelRouter<McpServiceTokenDocument>(MCP_SERVICE_TOKENS_ROUTE_PATH, McpServiceToken, {
    collectionActions: {
      create: {
        body: createBody,
        description:
          "Mints a personal MCP service token that acts as the signed-in user on POST /mcp. The plaintext token is returned once.",
        handler: async ({body, req, user}) => {
          const owner = requireAuthenticatedUser(user);
          const {expiresAt: rawExpiresAt, name: rawName} = body as z.infer<typeof createBody>;
          const name = parseName(rawName);
          const expiresAt = parseExpiresAt(rawExpiresAt);
          const activeCount = await McpServiceToken.countActiveForUser(String(owner._id));
          if (activeCount >= MAX_ACTIVE_MCP_SERVICE_TOKENS) {
            throw new BadRequestError({
              title: `Maximum of ${MAX_ACTIVE_MCP_SERVICE_TOKENS} active MCP service tokens`,
            });
          }
          const issued = await McpServiceToken.issueFor({_id: owner._id}, {expiresAt, name});
          return {
            created: issued.mcpServiceToken.created.toISOString(),
            expiresAt: issued.mcpServiceToken.expiresAt
              ? issued.mcpServiceToken.expiresAt.toISOString()
              : null,
            id: String(issued.mcpServiceToken._id),
            mcpUrl: resolveMcpUrl(req, options.publicMcpUrl),
            name: issued.mcpServiceToken.name,
            token: issued.token,
            tokenPrefix: issued.mcpServiceToken.tokenPrefix,
          };
        },
        method: "POST",
        permissions: [Permissions.IsAuthenticated],
        response: createdTokenResponse,
        summary: "Create an MCP service token",
        tag: ACTION_TAG,
      },
    },
    defaultLimit: DEFAULT_LIST_LIMIT,
    instanceActions: {
      revoke: {
        description:
          "Sets revokedAt on a token owned by the signed-in user. Unknown, foreign, and already revoked tokens are 404.",
        handler: async ({doc, user}) => {
          const owner = requireAuthenticatedUser(user);
          const token = doc as McpServiceTokenDocument;
          if (String(token.userId) !== String(owner._id)) {
            throw new NotFoundError("MCP service token not found");
          }
          const revoked = await McpServiceToken.revokeForUser({_id: owner._id}, token._id);
          if (!revoked) {
            throw new NotFoundError("MCP service token not found");
          }
          return toPublicMcpServiceToken(revoked.toObject() as Record<string, unknown>);
        },
        method: "POST",
        permissions: [Permissions.IsAuthenticated],
        summary: "Revoke an MCP service token",
        tag: ACTION_TAG,
      },
    },
    maxLimit: MAX_LIST_LIMIT,
    openApi: options.openApi,
    permissions: {
      create: [],
      delete: [],
      list: [Permissions.IsAuthenticated],
      read: [isTokenOwner],
      update: [],
    },
    queryFields: ["_id"],
    queryFilter: (user?: User) => (user?.id ? {userId: user.id} : null),
    responseHandler:
      mcpServiceTokenResponseHandler as ModelRouterOptions<McpServiceTokenDocument>["responseHandler"],
    sort: "-created",
    sync: {
      responseHandler: (doc) => toPublicMcpServiceToken(doc),
      scope: {field: "userId", type: "owner"},
    },
  });

/**
 * Mount the self-serve MCP service token routes at `/mcp/service-tokens`. Callers must
 * authenticate with a session or JWT; an `mcp_` bearer is rejected so a service token
 * cannot list, mint, or revoke tokens.
 */
export const addMcpServiceTokenRoutes = (
  app: Application,
  options: McpServiceTokenRoutesOptions = {}
): void => {
  const registration = createMcpServiceTokenRouter(options);
  app.use(MCP_SERVICE_TOKENS_ROUTE_PATH, rejectMcpServiceTokenBearer, registration.router);
};
