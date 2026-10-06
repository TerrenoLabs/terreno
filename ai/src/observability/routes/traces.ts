import {APIError, asyncHandler, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import type {LocalTraceStore} from "../local/traceStore";
import {getObservabilityApp} from "../observabilityAppRegistry";
import type {ScoreRecord, ScoreSink} from "../types";
import {
  type ObservabilityRouteAccessOptions,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";

const BASE_PATH = "/ai/observability";

export interface ObservabilityTraceRouteOptions extends ObservabilityRouteAccessOptions {
  store: LocalTraceStore;
}

const parseBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  throw new APIError({status: 400, title: "boolean query must be true or false"});
};

const parsePromptVersion = (value: unknown, prompt?: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new APIError({status: 400, title: "promptVersion must be a positive integer"});
  }
  if (!prompt) {
    throw new APIError({status: 400, title: "prompt is required when promptVersion is set"});
  }
  return parsed;
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

export const addObservabilityTraceRoutes = (
  router: express.Application,
  options: ObservabilityTraceRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.get(
    `${BASE_PATH}/traces`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiTrace"},
      builder()
        .withTags(["observability"])
        .withSummary("List observability traces")
        .withQueryParameter("prompt", {type: "string"}, {required: false})
        .withQueryParameter("promptVersion", {type: "number"}, {required: false})
        .withQueryParameter("scope", {type: "string"}, {required: false})
        .withResponse(200, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const prompt = typeof req.query.prompt === "string" ? req.query.prompt : undefined;
      const listed = await options.store.list({
        flaggedForDataset: parseBoolean(req.query.flaggedForDataset),
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        hasScore: parseBoolean(req.query.hasScore),
        limit: parsePositiveInt(req.query.limit, 20),
        page: parsePositiveInt(req.query.page, 1),
        prompt,
        promptVersion: parsePromptVersion(req.query.promptVersion, prompt),
        scope: typeof req.query.scope === "string" ? req.query.scope : undefined,
        sensitive: parseBoolean(req.query.sensitive),
        sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
        status:
          req.query.status === "ok" || req.query.status === "error" ? req.query.status : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
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

  router.get(
    `${BASE_PATH}/traces/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiTrace"},
      builder()
        .withTags(["observability"])
        .withSummary("Get an observability trace")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.store.getDetail(req.params.id);
      return res.json({data});
    })
  );

  router.post(
    `${BASE_PATH}/traces/:id/scores`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "score", resource: "aiReview"},
      builder()
        .withTags(["observability"])
        .withSummary("Add a score to a trace")
        .withPathParameter("id", {type: "string"})
        .withResponse(201, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      await options.store.getDetail(req.params.id);
      const body = req.body as Partial<ScoreRecord>;
      if (!body.name || body.value === undefined || !body.dataType || !body.source) {
        throw new APIError({
          status: 400,
          title: "name, value, dataType, and source are required",
        });
      }
      const score: ScoreRecord = {
        comment: body.comment,
        confidence: body.confidence,
        dataType: body.dataType,
        name: body.name,
        source: body.source,
        spanId: body.spanId,
        traceId: req.params.id,
        value: body.value,
      };
      const sinks: ScoreSink[] = getObservabilityApp()?.scoreSinks ?? [];
      if (sinks.length === 0) {
        await options.store.exportScore(score);
      } else {
        const results = await Promise.allSettled(
          sinks.map((sink) => {
            return sink.export(score);
          })
        );
        for (const result of results) {
          if (result.status === "rejected") {
            throw result.reason;
          }
        }
      }
      return res.status(201).json({data: score});
    })
  );
};
