import {APIError, asyncHandler, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import {DateTime} from "luxon";
import type mongoose from "mongoose";
import {AIRequest} from "../../models/aiRequest";
import type {
  LocalPromptStore,
  PlaygroundGenerator,
  PromptVersionFields,
} from "../local/promptStore";
import type {
  ModelPrice,
  ObservabilityGenerateClient,
  ObservabilityRequestAiServiceFactory,
} from "../types";
import {
  type ObservabilityRouteAccessOptions,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";
import {resolveRequestAiService} from "./requestAiService";

const BASE_PATH = "/ai/observability";

export interface ObservabilityPromptRouteOptions extends ObservabilityRouteAccessOptions {
  aiService?: ObservabilityGenerateClient;
  openApi?: unknown;
  priceMap?: Record<string, ModelPrice>;
  requestAiServiceFactory?: ObservabilityRequestAiServiceFactory;
  store: LocalPromptStore;
}

const asUserId = (user: unknown): mongoose.Types.ObjectId | undefined => {
  if (!user || typeof user !== "object" || !("_id" in user)) {
    return undefined;
  }
  return (user as {_id?: mongoose.Types.ObjectId})._id;
};

const parsePromptVersionQuery = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new APIError({status: 400, title: "promptVersion must be a positive integer"});
  }
  return parsed;
};

const versionFieldsFromBody = (body: Record<string, unknown>): PromptVersionFields => {
  return {
    config: body.config as Record<string, unknown> | undefined,
    inputSchema: body.inputSchema as Record<string, unknown> | undefined,
    outputFieldNotes: body.outputFieldNotes as Record<string, string> | undefined,
    outputSchema: body.outputSchema as Record<string, unknown> | undefined,
    sensitive: body.sensitive as boolean | undefined,
    system: body.system as string | undefined,
    template: body.template as string | undefined,
    type: (body.type as "chat" | "text" | undefined) ?? "text",
    variables: body.variables as PromptVersionFields["variables"],
  };
};

const createPlaygroundGenerator = (aiService: ObservabilityGenerateClient): PlaygroundGenerator => {
  return {
    generate: async ({prompt, systemPrompt, userId}) => {
      const started = DateTime.utc();
      const output = await aiService.generateText({
        prompt,
        skipTrace: true,
        systemPrompt,
        userId,
      });
      const filter: Record<string, unknown> = {};
      if (userId) {
        filter.userId = userId;
      }
      const recent = await AIRequest.find(filter).sort({created: -1}).limit(1);
      const last = recent[0];
      const metadata = (last?.metadata ?? {}) as {inputTokens?: number; outputTokens?: number};
      return {
        inputTokens: metadata.inputTokens,
        latencyMs:
          last?.responseTime ?? DateTime.utc().diff(started, "milliseconds").as("milliseconds"),
        output,
        outputTokens: metadata.outputTokens,
      };
    },
  };
};

export const addObservabilityPromptRoutes = (
  router: express.Application,
  options: ObservabilityPromptRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.get(
    `${BASE_PATH}/prompts`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiPrompt"},
      builder()
        .withTags(["observability"])
        .withSummary("List observability prompts")
        .withQueryParameter("folder", {type: "string"}, {required: false})
        .withQueryParameter("search", {type: "string"}, {required: false})
        .withQueryParameter("include", {type: "string"}, {required: false})
        .withResponse(200, {data: {type: "array"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const include = typeof req.query.include === "string" ? req.query.include : undefined;
      const data = await options.store.list({
        folder: typeof req.query.folder === "string" ? req.query.folder : undefined,
        includeUsage7d: include === "usage7d",
        search: typeof req.query.search === "string" ? req.query.search : undefined,
      });
      return res.json({data});
    })
  );

  router.post(
    `${BASE_PATH}/prompts`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "create", resource: "aiPrompt"},
      builder()
        .withTags(["observability"])
        .withSummary("Create an observability prompt")
        .withRequestBody({
          description: {required: false, type: "string"},
          folder: {required: true, type: "string"},
          name: {required: true, type: "string"},
        })
        .withResponse(201, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const created = await options.store.create({
        ...versionFieldsFromBody(body),
        description: typeof body.description === "string" ? body.description : undefined,
        folder: String(body.folder ?? ""),
        name: String(body.name ?? ""),
        tags: body.tags as string[] | undefined,
      });
      return res.status(201).json({data: created});
    })
  );

  router.get(
    `${BASE_PATH}/prompts/:name`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiPrompt"},
      builder()
        .withTags(["observability"])
        .withSummary("Get an observability prompt")
        .withPathParameter("name", {type: "string"})
        .withQueryParameter("promptVersion", {type: "number"}, {required: false})
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const promptVersion = parsePromptVersionQuery(req.query.promptVersion);
      const data = await options.store.getDetail(req.params.name, {promptVersion});
      return res.json({data});
    })
  );

  router.post(
    `${BASE_PATH}/prompts/:name/versions`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "update", resource: "aiPrompt"},
      builder()
        .withTags(["observability"])
        .withSummary("Create the next immutable prompt version")
        .withPathParameter("name", {type: "string"})
        .withResponse(201, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const created = await options.store.createVersion(
        req.params.name,
        versionFieldsFromBody(req.body as Record<string, unknown>)
      );
      return res.status(201).json({data: created});
    })
  );

  router.post(
    `${BASE_PATH}/prompts/:name/labels`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "promote", resource: "aiPrompt"},
      builder()
        .withTags(["observability"])
        .withSummary("Move a prompt label")
        .withPathParameter("name", {type: "string"})
        .withRequestBody({
          label: {required: true, type: "string"},
          version: {required: true, type: "number"},
        })
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {label?: string; version?: number};
      if (!body.label || body.version === undefined) {
        throw new APIError({status: 400, title: "label and version are required"});
      }
      const data = await options.store.moveLabel(req.params.name, {
        label: body.label,
        version: body.version,
      });
      return res.json({data});
    })
  );

  router.post(
    `${BASE_PATH}/prompts/:name/playground`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "playground", resource: "aiPrompt"},
      builder()
        .withTags(["observability"])
        .withSummary("Compile and run a prompt version once")
        .withPathParameter("name", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {
        modelId?: string;
        userPrompt?: string;
        variables?: Record<string, string>;
        version?: number;
      };
      const aiService = resolveRequestAiService({
        aiService: options.aiService,
        modelId: body.modelId,
        req,
        requestAiServiceFactory: options.requestAiServiceFactory,
      });
      const data = await options.store.runPlayground({
        generator: createPlaygroundGenerator(aiService),
        modelId: aiService.modelId,
        name: req.params.name,
        priceMap: options.priceMap,
        userId: asUserId(req.user),
        userPrompt: body.userPrompt,
        variables: body.variables,
        version: body.version,
      });
      return res.json({data});
    })
  );
};
