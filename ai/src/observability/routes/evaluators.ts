import {APIError, asyncHandler, createOpenApiBuilder} from "@terreno/api";
import type express from "express";

import {EVALUATOR_TEMPLATES} from "../evaluatorTemplates";
import type {EvaluatorWriteInput, LocalEvaluatorStore} from "../local/evaluatorStore";
import {
  type ObservabilityRouteAccessOptions,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";

const BASE_PATH = "/ai/observability";

export interface ObservabilityEvaluatorRouteOptions extends ObservabilityRouteAccessOptions {
  store: LocalEvaluatorStore;
}

const writeFromBody = (
  body: Record<string, unknown>,
  mode: "create" | "update"
): Partial<EvaluatorWriteInput> => {
  const input: Partial<EvaluatorWriteInput> = {};
  if (typeof body.name === "string") {
    input.name = body.name;
  }
  if (body.target) {
    input.target = body.target as EvaluatorWriteInput["target"];
  }
  if (body.type) {
    input.type = body.type as EvaluatorWriteInput["type"];
  }
  if (Array.isArray(body.dimensions)) {
    input.dimensions = body.dimensions as EvaluatorWriteInput["dimensions"];
  }
  if (body.runModes) {
    input.runModes = body.runModes as EvaluatorWriteInput["runModes"];
  }
  if (typeof body.instructions === "string") {
    input.instructions = body.instructions;
  }
  if (typeof body.description === "string") {
    input.description = body.description;
  }
  if (typeof body.confidenceAlertBelow === "number") {
    input.confidenceAlertBelow = body.confidenceAlertBelow;
  }
  if (typeof body.judgePromptName === "string") {
    input.judgePromptName = body.judgePromptName;
  }
  if (body.assertion && typeof body.assertion === "object") {
    input.assertion = body.assertion as EvaluatorWriteInput["assertion"];
  }
  if (mode === "create") {
    return {
      ...input,
      dimensions: input.dimensions ?? [],
      name: input.name ?? "",
      // TODO: enable generation span and dataset item targets.
      target: input.target ?? "full trace",
      type: input.type ?? "human",
    };
  }
  return input;
};

export const addObservabilityEvaluatorRoutes = (
  router: express.Application,
  options: ObservabilityEvaluatorRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.get(
    `${BASE_PATH}/evaluators/templates`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiEvaluator"},
      builder()
        .withTags(["observability"])
        .withSummary("List seeded evaluator templates")
        .withResponse(200, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (_req, res) => {
      return res.json({data: EVALUATOR_TEMPLATES});
    })
  );

  router.post(
    `${BASE_PATH}/evaluators/templates/:name`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "create", resource: "aiEvaluator"},
      builder()
        .withTags(["observability"])
        .withSummary("Install a seeded evaluator template")
        .withPathParameter("name", {type: "string"})
        .withResponse(201, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.store.installTemplate(req.params.name);
      return res.status(201).json({data});
    })
  );

  router.get(
    `${BASE_PATH}/evaluators`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiEvaluator"},
      builder()
        .withTags(["observability"])
        .withSummary("List evaluators")
        .withResponse(200, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (_req, res) => {
      return res.json({data: await options.store.list()});
    })
  );

  router.post(
    `${BASE_PATH}/evaluators`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "create", resource: "aiEvaluator"},
      builder()
        .withTags(["observability"])
        .withSummary("Create an evaluator")
        .withResponse(201, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const input = writeFromBody(
        req.body as Record<string, unknown>,
        "create"
      ) as EvaluatorWriteInput;
      // TODO: enable generation span and dataset item targets.
      if (input.target !== "full trace") {
        throw new APIError({
          status: 400,
          title: "Only full trace evaluators are supported",
        });
      }
      const data = await options.store.create(input);
      return res.status(201).json({data});
    })
  );

  router.get(
    `${BASE_PATH}/evaluators/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiEvaluator"},
      builder()
        .withTags(["observability"])
        .withSummary("Get an evaluator")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      return res.json({data: await options.store.get(req.params.id)});
    })
  );

  router.patch(
    `${BASE_PATH}/evaluators/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "update", resource: "aiEvaluator"},
      builder()
        .withTags(["observability"])
        .withSummary("Update an evaluator")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.store.update(
        req.params.id,
        writeFromBody(req.body as Record<string, unknown>, "update")
      );
      return res.json({data});
    })
  );

  router.delete(
    `${BASE_PATH}/evaluators/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "delete", resource: "aiEvaluator"},
      builder()
        .withTags(["observability"])
        .withSummary("Delete an evaluator")
        .withPathParameter("id", {type: "string"})
        .withResponse(204, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      await options.store.remove(req.params.id);
      return res.status(204).end();
    })
  );
};
