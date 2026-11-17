import {APIError, asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import {FEEDBACK_SIGNALS, recordTraceFeedback, type TraceFeedbackInput} from "../feedback";
import {
  DEFAULT_TRACE_LIST_SORT,
  type LocalTraceStore,
  parseTraceListSort,
  TRACE_LIST_SORT_KEYS,
} from "../local/traceStore";
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

const parsePromptVersion = (value: unknown, prompt?: string | string[]): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new APIError({status: 400, title: "promptVersion must be a positive integer"});
  }
  if (!prompt || prompt.length === 0) {
    throw new APIError({status: 400, title: "prompt is required when promptVersion is set"});
  }
  return parsed;
};

const parsePrompt = (value: unknown): string | string[] | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as string[];
  }
  if (value === undefined) {
    return undefined;
  }
  throw new APIError({status: 400, title: "prompt must be a string or a list of strings"});
};

const parseSort = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new APIError({status: 400, title: "Unknown trace sort key"});
  }
  // Validate here so a bad key fails before the store runs any query.
  parseTraceListSort(value);
  return value;
};

const parseThumbs = (value: unknown): "down" | "up" | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === "up" || value === "down") {
    return value;
  }
  throw new APIError({status: 400, title: "thumbs must be up or down"});
};

const parseSignal = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && (FEEDBACK_SIGNALS as readonly string[]).includes(value)) {
    return value;
  }
  throw new APIError({
    status: 400,
    title: `signal must be one of ${FEEDBACK_SIGNALS.join(", ")}`,
  });
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
        .withQueryParameter("thumbs", {enum: ["up", "down"], type: "string"}, {required: false})
        .withQueryParameter(
          "signal",
          {enum: [...FEEDBACK_SIGNALS], type: "string"},
          {required: false}
        )
        .withQueryParameter("hasComment", {type: "boolean"}, {required: false})
        .withQueryParameter(
          "sort",
          {
            enum: TRACE_LIST_SORT_KEYS.flatMap((key) => [key, `-${key}`]),
            type: "string",
          },
          {
            description: `Sort column, \`-\` prefix for descending. Defaults to \`${DEFAULT_TRACE_LIST_SORT}\`.`,
            required: false,
          }
        )
        .withResponse(200, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const prompt = parsePrompt(req.query.prompt);
      const listed = await options.store.list({
        flaggedForDataset: parseBoolean(req.query.flaggedForDataset),
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        hasComment: parseBoolean(req.query.hasComment),
        hasScore: parseBoolean(req.query.hasScore),
        limit: parsePositiveInt(req.query.limit, 20),
        page: parsePositiveInt(req.query.page, 1),
        prompt,
        promptVersion: parsePromptVersion(req.query.promptVersion, prompt),
        scope: typeof req.query.scope === "string" ? req.query.scope : undefined,
        sensitive: parseBoolean(req.query.sensitive),
        sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
        signal: parseSignal(req.query.signal),
        sort: parseSort(req.query.sort),
        status:
          req.query.status === "ok" || req.query.status === "error" ? req.query.status : undefined,
        thumbs: parseThumbs(req.query.thumbs),
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

  // End-user feedback: authenticated and owner-only, so it skips the admin observability
  // middleware every other route here uses.
  router.post(
    `${BASE_PATH}/traces/:id/feedback`,
    authenticateMiddleware(),
    builder()
      .withTags(["observability"])
      .withSummary("Record the trace owner's feedback on an AI output")
      .withDescription(
        "Thumbs (with an optional comment), outcome class, a passive signal, or flag-for-dataset. " +
          "Only the trace's own user may call it."
      )
      .withPathParameter("id", {type: "string"})
      .withRequestBody({
        comment: {
          description: "Free-text comment attached to the thumbs or outcome score (≤ 2000 chars)",
          type: "string",
        },
        flagDataset: {description: "Flag the trace as a dataset candidate", type: "boolean"},
        outcome: {enum: ["tp", "fp", "tn", "fn"], type: "string"},
        signal: {enum: [...FEEDBACK_SIGNALS], type: "string"},
        thumbs: {enum: ["up", "down"], nullable: true, type: "string"},
      })
      .withResponse(200, {
        data: {
          properties: {
            flaggedForDataset: {type: "boolean"},
            reviewItemId: {type: "string"},
            scores: {items: {type: "object"}, type: "array"},
            traceId: {type: "string"},
          },
          type: "object",
        },
      })
      .build(),
    asyncHandler(async (req, res) => {
      const user = req.user as {_id?: unknown; admin?: boolean} | undefined;
      const data = await recordTraceFeedback({
        input: req.body as TraceFeedbackInput,
        traceId: req.params.id,
        user: {admin: user?.admin, id: String(user?._id)},
      });
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
