import {APIError, asyncHandler, createOpenApiBuilder} from "@terreno/api";
import type express from "express";

import {EXPERIMENT_LIST_DEFAULT_LIMIT, type LocalExperimentRunner} from "../local/experimentRunner";
import {
  type ObservabilityRouteAccessOptions,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";

const BASE_PATH = "/ai/observability";

export interface ObservabilityExperimentRouteOptions extends ObservabilityRouteAccessOptions {
  runner: LocalExperimentRunner;
}

const parseOptionalPromptName = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
};

const parsePositiveInt = (value: unknown, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new APIError({status: 400, title: "page and limit must be positive integers"});
  }
  return parsed;
};

export const addObservabilityExperimentRoutes = (
  router: express.Application,
  options: ObservabilityExperimentRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.post(
    `${BASE_PATH}/experiments/estimate`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "create", resource: "aiExperiment"},
      builder()
        .withTags(["observability"])
        .withSummary("Estimate experiment cost and runtime")
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.runner.estimate(req.body);
      return res.json({data});
    })
  );

  router.get(
    `${BASE_PATH}/experiments`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiExperiment"},
      builder()
        .withTags(["observability"])
        .withSummary("List experiments")
        .withQueryParameter("promptName", {type: "string"}, {required: false})
        .withQueryParameter("page", {type: "number"}, {required: false})
        .withQueryParameter("limit", {type: "number"}, {required: false})
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const listed = await options.runner.list({
        limit: parsePositiveInt(req.query.limit, EXPERIMENT_LIST_DEFAULT_LIMIT),
        page: parsePositiveInt(req.query.page, 1),
        promptName: parseOptionalPromptName(req.query.promptName),
      });
      const {limit, page, total} = listed.meta;
      return res.json({
        data: listed.data,
        limit,
        more: page * limit < total,
        page,
        total,
      });
    })
  );

  router.post(
    `${BASE_PATH}/experiments`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "create", resource: "aiExperiment"},
      builder()
        .withTags(["observability"])
        .withSummary("Create an experiment")
        .withResponse(201, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.runner.create(req.body);
      return res.status(201).json({data});
    })
  );

  router.get(
    `${BASE_PATH}/experiments/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiExperiment"},
      builder()
        .withTags(["observability"])
        .withSummary("Get experiment detail")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      return res.json({data: await options.runner.get(req.params.id)});
    })
  );

  router.post(
    `${BASE_PATH}/experiments/:id/promote`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "promote", resource: "aiExperiment"},
      builder()
        .withTags(["observability"])
        .withSummary("Promote a passing experiment version to production")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {version?: number};
      const experiment = await options.runner.get(req.params.id);
      const version = body.version ?? experiment.versions[experiment.versions.length - 1];
      const data = await options.runner.promote(req.params.id, version);
      return res.json({data});
    })
  );
};
