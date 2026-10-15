import {APIError, asyncHandler, createOpenApiBuilder} from "@terreno/api";
import type express from "express";

import type {LocalReviewBatchStore} from "../local/reviewBatchStore";
import type {ObservabilityGenerateClient, ObservabilityRequestAiServiceFactory} from "../types";
import {
  type ObservabilityRouteAccessOptions,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";
import {resolveRequestAiService} from "./requestAiService";

const BASE_PATH = "/ai/observability";

export interface ObservabilityReviewBatchRouteOptions extends ObservabilityRouteAccessOptions {
  aiService?: ObservabilityGenerateClient;
  requestAiServiceFactory?: ObservabilityRequestAiServiceFactory;
  store: LocalReviewBatchStore;
}

/** Register before the review item routes so `/review/batches` is not read as an item id. */
export const addObservabilityReviewBatchRoutes = (
  router: express.Application,
  options: ObservabilityReviewBatchRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.get(
    `${BASE_PATH}/review/batches`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("List human review batches with judge agreement")
        .withResponse(200, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (_req, res) => {
      return res.json({data: await options.store.list(), more: false});
    })
  );

  router.post(
    `${BASE_PATH}/review/batches`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "assign", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("Create a review batch from traces or the most recent traces")
        .withResponse(201, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {
        description?: string;
        evaluatorId?: string;
        limit?: number;
        name?: string;
        promptName?: string;
        traceIds?: string[];
      };
      if (!body.evaluatorId) {
        throw new APIError({status: 400, title: "evaluatorId is required"});
      }
      if (body.traceIds !== undefined && !Array.isArray(body.traceIds)) {
        throw new APIError({status: 400, title: "traceIds must be an array"});
      }
      const data = await options.store.create({
        description: body.description,
        evaluatorId: body.evaluatorId,
        limit: body.limit,
        name: body.name,
        promptName: body.promptName || undefined,
        traceIds: body.traceIds,
      });
      return res.status(201).json({data});
    })
  );

  router.get(
    `${BASE_PATH}/review/batches/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("Get a review batch with human answers and judge agreement")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      return res.json({data: await options.store.get(req.params.id)});
    })
  );

  router.post(
    `${BASE_PATH}/review/batches/:id/judgeRuns`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "assign", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("Run an LLM judge over a review batch")
        .withPathParameter("id", {type: "string"})
        .withResponse(201, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {evaluatorId?: string};
      if (!body.evaluatorId) {
        throw new APIError({status: 400, title: "evaluatorId is required"});
      }
      const ai = resolveRequestAiService({
        aiService: options.aiService,
        req,
        requestAiServiceFactory: options.requestAiServiceFactory,
      });
      const data = await options.store.runJudge({
        ai,
        batchId: req.params.id,
        evaluatorId: body.evaluatorId,
      });
      return res.status(201).json({data});
    })
  );
};
