import {APIError, asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import {DateTime} from "luxon";

import {AIRequest} from "../models/aiRequest";
import type {AiRequestsExplorerRouteOptions} from "../types";

const parseRequestTypes = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => parseRequestTypes(item));
  }
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
};

export const addAiRequestsExplorerRoutes = (
  router: express.Router,
  options?: AiRequestsExplorerRouteOptions
): void => {
  router.get(
    "/aiRequestsExplorer",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options?.openApiOptions ?? {})
        .withTags(["admin"])
        .withSummary("List AI requests (admin only)")
        .withQueryParameter("page", {type: "number"}, {required: false})
        .withQueryParameter("limit", {type: "number"}, {required: false})
        .withQueryParameter("requestType", {type: "string"}, {required: false})
        .withQueryParameter("model", {type: "string"}, {required: false})
        .withQueryParameter("startDate", {type: "string"}, {required: false})
        .withQueryParameter("endDate", {type: "string"}, {required: false})
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
      const user = req.user as {admin?: boolean} | undefined;
      if (!user?.admin) {
        return res.status(403).json({error: "Admin access required"});
      }

      const page = Math.max(1, Number.parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(req.query.limit as string, 10) || 20)
      );
      const skip = (page - 1) * limit;

      const match: Record<string, unknown> & {created?: {$gte?: Date; $lte?: Date}} = {
        deleted: {$ne: true},
      };

      const requestTypes = parseRequestTypes(req.query.requestType);
      if (requestTypes.length === 1) {
        match.requestType = {$eq: requestTypes[0]};
      } else if (requestTypes.length > 1) {
        match.requestType = {$in: requestTypes};
      }
      const model: unknown = req.query.model;
      if (typeof model === "string") {
        if (model) {
          match.aiModel = {$eq: model};
        }
      } else if (model !== undefined) {
        throw new APIError({status: 400, title: "model must be a string"});
      }
      if (req.query.startDate || req.query.endDate) {
        match.created = {};
        if (req.query.startDate) {
          const startDt = DateTime.fromISO(req.query.startDate as string, {zone: "utc"});
          if (!startDt.isValid) {
            throw new APIError({
              status: 400,
              title: "Invalid startDate format (expected ISO 8601)",
            });
          }
          match.created.$gte = startDt.toJSDate();
        }
        if (req.query.endDate) {
          const endDt = DateTime.fromISO(req.query.endDate as string, {zone: "utc"});
          if (!endDt.isValid) {
            throw new APIError({status: 400, title: "Invalid endDate format (expected ISO 8601)"});
          }
          match.created.$lte = endDt.toJSDate();
        }
      }

      const [results, totalCount] = await Promise.all([
        AIRequest.aggregate([
          {$match: match},
          {$sort: {created: -1}},
          {$skip: skip},
          {$limit: limit},
          {
            $lookup: {
              as: "user",
              foreignField: "_id",
              from: "users",
              localField: "userId",
            },
          },
          {$unwind: {path: "$user", preserveNullAndEmptyArrays: true}},
          {
            $project: {
              aiModel: 1,
              created: 1,
              error: 1,
              prompt: {$substrCP: ["$prompt", 0, 200]},
              requestType: 1,
              response: {$substrCP: [{$ifNull: ["$response", ""]}, 0, 200]},
              responseTime: 1,
              tokensUsed: 1,
              "user.email": 1,
              "user.name": 1,
              userId: 1,
            },
          },
        ]),
        AIRequest.countDocuments(match),
      ]);

      return res.json({
        data: results,
        limit,
        more: skip + limit < totalCount,
        page,
        total: totalCount,
      });
    })
  );
};
