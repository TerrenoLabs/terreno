import type {Application, NextFunction, Request, Response} from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {asyncHandler, type OpenApiMiddleware} from "../api";
import {authenticateMiddleware, type User} from "../auth";
import {BadRequestError, NotFoundError, UnauthorizedError} from "../errors";
import {MCP_SERVICE_TOKEN_PREFIX, McpServiceToken} from "../models/mcpServiceToken";
import {createOpenApiBuilder} from "../openApiBuilder";
import type {McpServiceTokenDocument} from "../types/mcpServiceToken";
import {userTokenEpoch} from "./auth";

export const MAX_ACTIVE_MCP_SERVICE_TOKENS = 10;

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 100;

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
  if (token?.startsWith(MCP_SERVICE_TOKEN_PREFIX)) {
    next(new UnauthorizedError("MCP service tokens cannot manage service tokens"));
    return;
  }
  next();
};

const requireAuthenticatedUser = (req: Request): User => {
  const user = req.user as unknown as User | undefined;
  if (!user?._id) {
    throw new UnauthorizedError("Unauthorized");
  }
  return user;
};

const parseName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new BadRequestError({title: "name is required"});
  }
  const name = value.trim();
  if (!name) {
    throw new BadRequestError({title: "name is required"});
  }
  return name;
};

const parseExpiresAt = (value: unknown): Date | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestError({title: "expiresAt must be an ISO-8601 datetime string"});
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

const parsePage = (value: unknown): number => {
  if (value === undefined) {
    return 1;
  }
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new BadRequestError({code: "invalid-page", title: "Invalid page"});
  }
  return page;
};

const parseLimit = (value: unknown): number => {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadRequestError({title: "Invalid limit"});
  }
  return Math.min(limit, MAX_LIST_LIMIT);
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

const toListItem = (doc: McpServiceTokenDocument): Record<string, unknown> => {
  return {
    created: doc.created.toISOString(),
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
    id: String(doc._id),
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
    name: doc.name,
    revokedAt: doc.revokedAt ? doc.revokedAt.toISOString() : null,
    tokenPrefix: doc.tokenPrefix,
  };
};

const serviceTokenGuards = [rejectMcpServiceTokenBearer, authenticateMiddleware()];

const createdTokenFields = {
  created: {type: "string"},
  expiresAt: {type: "string"},
  id: {type: "string"},
  mcpUrl: {type: "string"},
  name: {type: "string"},
  token: {type: "string"},
  tokenPrefix: {type: "string"},
};

export const addMcpServiceTokenRoutes = (
  app: Application,
  options: McpServiceTokenRoutesOptions = {}
): void => {
  const openApiOptions = {openApi: options.openApi};

  app.post(
    "/mcp/service-tokens",
    [
      ...serviceTokenGuards,
      createOpenApiBuilder(openApiOptions)
        .withTags(["mcp"])
        .withOperationId("createMcpServiceToken")
        .withSummary("Create an MCP service token")
        .withDescription(
          "Mints a personal MCP service token that acts as the signed-in user on POST /mcp. The plaintext token is returned once."
        )
        .withRequestBody({
          expiresAt: {
            description: "Optional ISO-8601 expiry; omit for a token that does not expire",
            type: "string",
          },
          name: {
            description: "User-visible label for this token",
            required: true,
            type: "string",
          },
        })
        .withResponse(200, {
          data: {
            properties: createdTokenFields,
            type: "object",
          },
        })
        .build(),
    ],
    asyncHandler(async (req, res) => {
      const user = requireAuthenticatedUser(req);
      const name = parseName(req.body?.name);
      const expiresAt = parseExpiresAt(req.body?.expiresAt);
      await McpServiceToken.revokeOutdatedForUser({
        _id: user._id,
        tokenEpoch: userTokenEpoch(user),
      });
      const activeCount = await McpServiceToken.countActiveForUser(
        new mongoose.Types.ObjectId(String(user._id))
      );
      if (activeCount >= MAX_ACTIVE_MCP_SERVICE_TOKENS) {
        throw new BadRequestError({
          title: `Maximum of ${MAX_ACTIVE_MCP_SERVICE_TOKENS} active MCP service tokens`,
        });
      }
      const issued = await McpServiceToken.issueFor(
        {_id: user._id, tokenEpoch: userTokenEpoch(user)},
        {expiresAt, name}
      );
      return res.json({
        data: {
          created: issued.mcpServiceToken.created.toISOString(),
          expiresAt: issued.mcpServiceToken.expiresAt
            ? issued.mcpServiceToken.expiresAt.toISOString()
            : null,
          id: String(issued.mcpServiceToken._id),
          mcpUrl: resolveMcpUrl(req, options.publicMcpUrl),
          name: issued.mcpServiceToken.name,
          token: issued.token,
          tokenPrefix: issued.mcpServiceToken.tokenPrefix,
        },
      });
    })
  );

  app.get(
    "/mcp/service-tokens",
    [
      ...serviceTokenGuards,
      createOpenApiBuilder(openApiOptions)
        .withTags(["mcp"])
        .withOperationId("listMcpServiceTokens")
        .withSummary("List MCP service tokens")
        .withDescription(
          "Lists MCP service tokens owned by the signed-in user. Never includes plaintext or tokenHash."
        )
        .withQueryParameter("page", {type: "number"}, {required: false})
        .withQueryParameter("limit", {type: "number"}, {required: false})
        .withResponse(200, {
          data: {type: "array"},
          limit: {type: "number"},
          more: {type: "boolean"},
          page: {type: "number"},
          total: {type: "number"},
        })
        .build(),
    ],
    asyncHandler(async (req, res) => {
      const user = requireAuthenticatedUser(req);
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);
      // Tokens from before a password reset or session revocation no longer work; list them so.
      await McpServiceToken.revokeOutdatedForUser({
        _id: user._id,
        tokenEpoch: userTokenEpoch(user),
      });
      const filter = {userId: new mongoose.Types.ObjectId(String(user._id))};
      const total = await McpServiceToken.countDocuments(filter);
      const docs = await McpServiceToken.find(filter)
        .sort("-created")
        .skip((page - 1) * limit)
        .limit(limit + 1);
      const more = docs.length > limit;
      const pageDocs = more ? docs.slice(0, limit) : docs;
      return res.json({
        data: pageDocs.map(toListItem),
        limit,
        more,
        page,
        total,
      });
    })
  );

  app.delete(
    "/mcp/service-tokens/:id",
    [
      ...serviceTokenGuards,
      createOpenApiBuilder(openApiOptions)
        .withTags(["mcp"])
        .withOperationId("revokeMcpServiceToken")
        .withSummary("Revoke an MCP service token")
        .withDescription("Sets revokedAt on a token owned by the signed-in user.")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {
          data: {
            properties: {
              id: {type: "string"},
              revokedAt: {type: "string"},
            },
            type: "object",
          },
        })
        .build(),
    ],
    asyncHandler(async (req, res) => {
      const user = requireAuthenticatedUser(req);
      const tokenId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(tokenId)) {
        throw new NotFoundError("MCP service token not found");
      }
      const revoked = await McpServiceToken.revokeForUser(
        {_id: user._id},
        new mongoose.Types.ObjectId(tokenId)
      );
      if (!revoked) {
        throw new NotFoundError("MCP service token not found");
      }
      return res.json({
        data: {
          id: String(revoked._id),
          revokedAt: revoked.revokedAt ? revoked.revokedAt.toISOString() : null,
        },
      });
    })
  );
};
