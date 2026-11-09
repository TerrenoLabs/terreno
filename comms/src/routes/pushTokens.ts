import {
  APIError,
  asyncHandler,
  authenticateMiddleware,
  createOpenApiBuilder,
  type ModelRouterOptions,
  modelRouter,
  type OpenApiMiddleware,
  Permissions,
} from "@terreno/api";
import type express from "express";
import {DateTime} from "luxon";
import type {Model, QueryFilter, Types} from "mongoose";
import {PushToken} from "../models/pushToken";
import type {PushTokenDocument, PushTokenPlatform} from "../modelTypes";

interface PushTokenRouteOptions {
  basePath?: string;
  openApi?: unknown;
}

interface PushTokenRequestBody {
  deviceId?: string;
  platform?: PushTokenPlatform;
  token?: string;
}

const platformValues: PushTokenPlatform[] = ["android", "ios", "web"];

const openApiOptions = (openApi?: unknown): {openApi?: OpenApiMiddleware} =>
  openApi ? {openApi: openApi as OpenApiMiddleware} : {};

interface AuthenticatedUser {
  _id: unknown;
  admin?: boolean;
  id?: string;
  tokenEpoch?: number;
}

const getAuthenticatedUser = (req: express.Request): AuthenticatedUser => {
  const user = req.user as Partial<AuthenticatedUser> | undefined;
  if (!user?._id) {
    throw new APIError({status: 401, title: "Authentication required"});
  }
  return user as AuthenticatedUser;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  (error as {code?: number} | undefined)?.code === 11000;

/**
 * Claims a device token for the caller in a single atomic statement.
 *
 * The filter only matches a token that is unclaimed, already the caller's, or released by its
 * previous owner, so a concurrent request can never transfer an active token between accounts.
 * A token held by another user fails the filter, and the unique index turns the resulting upsert
 * insert into a duplicate-key error that surfaces as a conflict.
 */
const claimPushToken = async ({
  deviceId,
  platform,
  token,
  tokenEpoch,
  userId,
}: {
  deviceId?: string;
  platform: PushTokenPlatform;
  token: string;
  tokenEpoch: number;
  userId: Types.ObjectId;
}): Promise<{created: boolean; document: PushTokenDocument}> => {
  const now = DateTime.utc().toJSDate();
  const claimableFilter: QueryFilter<PushTokenDocument> = {
    $or: [{userId}, {active: false}],
    token,
  };
  const result = await PushToken.findOneAndUpdate(
    claimableFilter,
    {
      // createdUpdatedPlugin only hooks save(), so timestamps are maintained here.
      $set: {
        active: true,
        deleted: false,
        // Omitting deviceId preserves a previously registered identifier on refresh.
        ...(deviceId === undefined ? {} : {deviceId}),
        lastSeenAt: now,
        platform,
        // Binds the device to the session generation; a password reset or session revocation
        // ends delivery until the device registers again.
        tokenEpoch,
        updated: now,
        userId,
      },
      $setOnInsert: {created: now},
    },
    {
      includeResultMetadata: true,
      returnDocument: "after",
      runValidators: true,
      upsert: true,
    }
  );

  if (!result.value) {
    throw new APIError({status: 500, title: "Push token claim returned no document"});
  }
  return {created: result.lastErrorObject?.updatedExisting !== true, document: result.value};
};

export const addPushTokenRoutes = (
  app: express.Application,
  options?: PushTokenRouteOptions
): void => {
  const basePath = options?.basePath ?? "/comms/pushTokens";
  const routeOpenApi = openApiOptions(options?.openApi);

  // A dedicated create endpoint is required because modelRouter create cannot provide
  // the idempotent token upsert contract used by device registration.
  app.post(
    basePath,
    [
      authenticateMiddleware(),
      createOpenApiBuilder(routeOpenApi)
        .withTags(["comms"])
        .withSummary("Register or refresh a push token")
        .withRequestBody({
          deviceId: {type: "string"},
          platform: {
            description: "Device platform: android, ios, or web",
            required: true,
            type: "string",
          },
          token: {required: true, type: "string"},
        })
        .withResponse(200, {data: {type: "object"}})
        .withResponse(201, {data: {type: "object"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const user = getAuthenticatedUser(req);
      const body = req.body as PushTokenRequestBody;
      if (!body.token?.trim()) {
        throw new APIError({status: 400, title: "Push token is required"});
      }
      if (!body.platform || !platformValues.includes(body.platform)) {
        throw new APIError({status: 400, title: "Valid push platform is required"});
      }

      const claim = {
        deviceId: body.deviceId,
        platform: body.platform,
        token: body.token,
        tokenEpoch: typeof user.tokenEpoch === "number" ? user.tokenEpoch : 0,
        userId: user._id as Types.ObjectId,
      };

      let result: {created: boolean; document: PushTokenDocument};
      try {
        result = await claimPushToken(claim);
      } catch (error: unknown) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
        // A concurrent insert won the race. Retrying resolves the caller's own duplicate
        // registration and leaves a genuinely foreign token failing the filter again.
        try {
          result = await claimPushToken(claim);
        } catch (retryError: unknown) {
          if (!isDuplicateKeyError(retryError)) {
            throw retryError;
          }
          throw new APIError({status: 409, title: "Push token is registered to another user"});
        }
      }

      return res.status(result.created ? 201 : 200).json({data: result.document});
    })
  );

  app.get(
    basePath,
    [
      authenticateMiddleware(),
      createOpenApiBuilder(routeOpenApi)
        .withTags(["comms"])
        .withSummary("List the current user's push tokens")
        .withQueryParameter("page", {type: "number"}, {required: false})
        .withQueryParameter("limit", {type: "number"}, {required: false})
        .withQueryParameter("active", {type: "boolean"}, {required: false})
        .withQueryParameter("platform", {type: "string"}, {required: false})
        .withResponse(200, {
          data: {items: {type: "object"}, type: "array"},
          limit: {type: "number"},
          more: {type: "boolean"},
          page: {type: "number"},
          total: {type: "number"},
        })
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const user = getAuthenticatedUser(req);
      const page = Math.max(1, Number.parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(req.query.limit as string, 10) || 20)
      );
      const skip = (page - 1) * limit;
      const match: Record<string, unknown> = {userId: user._id};
      if (req.query.active === "true" || req.query.active === "false") {
        match.active = req.query.active === "true";
      }
      if (req.query.platform) {
        match.platform = req.query.platform;
      }
      const [tokens, total] = await Promise.all([
        PushToken.find(match).sort("-lastSeenAt").skip(skip).limit(limit),
        PushToken.countDocuments(match),
      ]);
      return res.json({
        data: tokens,
        limit,
        more: skip + limit < total,
        page,
        total,
      });
    })
  );

  app.delete(
    `${basePath}/:id`,
    [
      authenticateMiddleware(),
      createOpenApiBuilder(routeOpenApi)
        .withTags(["comms"])
        .withSummary("Deactivate a push token")
        .withPathParameter("id", {type: "string"})
        .withResponse(204, {})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const user = getAuthenticatedUser(req);
      const token = await PushToken.findExactlyOne({_id: req.params.id});
      const isOwner = token.userId.toString() === String(user._id);
      if (!isOwner) {
        throw new APIError({status: 403, title: "Push token belongs to another user"});
      }

      token.active = false;
      await token.save();
      return res.status(204).send();
    })
  );

  const routerOptions: ModelRouterOptions<PushTokenDocument> = {
    ...routeOpenApi,
    // Share the "comms" tag with the custom routes so generated SDK mutations invalidate this read.
    openApiOverwrite: {get: {tags: ["comms"]}},
    permissions: {
      create: [],
      delete: [],
      list: [],
      read: [Permissions.IsOwner],
      update: [],
    },
    queryFields: ["active", "platform"],
    // PushToken persists userId, while OwnerQueryFilter targets a persisted ownerId field.
    queryFilter: (user) => {
      if (!user) {
        return null;
      }
      return {userId: user.id};
    },
    sort: "-lastSeenAt",
  };
  app.use(basePath, modelRouter(PushToken as Model<PushTokenDocument>, routerOptions));
};
