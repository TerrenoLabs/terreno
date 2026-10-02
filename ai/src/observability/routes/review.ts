import {APIError, asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";
import type express from "express";

import type {LocalReviewStore, ReviewStatus} from "../local/reviewStore";
import {getObservabilityApp} from "../observabilityAppRegistry";
import {
  type ObservabilityRouteAccessOptions,
  observabilityReviewMutationMiddleware,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";

const BASE_PATH = "/ai/observability";

export interface ObservabilityReviewRouteOptions extends ObservabilityRouteAccessOptions {
  store: LocalReviewStore;
}

export const addObservabilityReviewRoutes = (
  router: express.Application,
  options: ObservabilityReviewRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.post(
    `${BASE_PATH}/traces/review`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "assign", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("Enqueue traces for human review")
        .withResponse(201, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {evaluatorId?: string; reason?: "manual"; traceIds?: string[]};
      if (!body.evaluatorId || !body.traceIds) {
        throw new APIError({status: 400, title: "evaluatorId and traceIds are required"});
      }
      const data = await options.store.enqueue({
        evaluatorId: body.evaluatorId,
        reason: body.reason ?? "manual",
        traceIds: body.traceIds,
      });
      return res.status(201).json({data});
    })
  );

  router.get(
    `${BASE_PATH}/review`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("List the review queue")
        .withResponse(200, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const status = req.query.status as ReviewStatus | undefined;
      return res.json({...(await options.store.list(status)), more: false});
    })
  );

  router.get(
    `${BASE_PATH}/review/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("Get a review item")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      return res.json({data: await options.store.getDetail(req.params.id)});
    })
  );

  router.post(
    `${BASE_PATH}/review/:id`,
    [
      authenticateMiddleware(),
      observabilityReviewMutationMiddleware(options.accessControl),
      builder()
        .withTags(["observability"])
        .withSummary("Submit, skip, or assign a review item")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build(),
    ],
    asyncHandler(async (req, res) => {
      const body = req.body as {
        action?: "assign" | "skip" | "submit";
        assigneeId?: string;
        comment?: string;
        scores?: Record<string, boolean | number | string>;
      };
      if (body.action === "submit") {
        await options.store.submit({
          comment: body.comment,
          id: req.params.id,
          scores: body.scores ?? {},
          sinks: getObservabilityApp()?.scoreSinks ?? [],
        });
      } else if (body.action === "skip") {
        await options.store.skip(req.params.id);
      } else if (body.action === "assign") {
        if (!body.assigneeId) {
          throw new APIError({status: 400, title: "assigneeId is required"});
        }
        await options.store.assign(req.params.id, body.assigneeId);
      } else {
        throw new APIError({status: 400, title: "action must be submit, skip, or assign"});
      }
      return res.json({data: await options.store.getDetail(req.params.id)});
    })
  );
};
