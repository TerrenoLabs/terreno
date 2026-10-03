import {
  APIError,
  asyncHandler,
  authenticateMiddleware,
  createOpenApiBuilder,
  isAPIError,
  logger,
  type OpenApiSchemaProperty,
} from "@terreno/api";
import {ASK_SURFACES, askSurfaceSchema} from "@terreno/blocks";
import type express from "express";
import {DateTime} from "luxon";
import type mongoose from "mongoose";

import {GptHistory} from "../models/gptHistory";
import {configureAiDatasets} from "../service/aiDatasets";
import {assertNoReservedToolNames, resolveAskKinds} from "../service/asks";
import {type ChatTurnSink, DEMO_RESPONSE, resolveAiService, runChatTurn} from "../service/chatTurn";
import type {GptRouteOptions} from "../types";
import {addGptActionRoutes} from "./gptActions";
import {addGptDatasetRoutes} from "./gptDatasets";

const ASK_RESPONSE_BODY: OpenApiSchemaProperty = {
  description:
    "The user's answer to the conversation's pending ask. Send it with historyId instead of prompt.",
  properties: {
    action: {enum: ["accept", "decline", "cancel"], type: "string"},
    content: {description: "The answer, when action is accept", type: "object"},
    reason: {description: "Why the ask was cancelled, when action is cancel", type: "string"},
    toolCallId: {description: "The pending ask's toolCallId", type: "string"},
  },
  type: "object",
};

const SURFACE_BODY: OpenApiSchemaProperty = {
  description: askSurfaceSchema.description,
  enum: [...ASK_SURFACES],
  type: "string",
};

interface SseSink extends ChatTurnSink {
  isOpen: () => boolean;
}

const DEFAULT_STREAM_RESUME_POLL_INTERVAL_MS = 500;
const DEFAULT_STREAM_STALE_AFTER_MS = 60_000;

const sseEvent = (payload: Record<string, unknown>): string =>
  `data: ${JSON.stringify(payload)}\n\n`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Writes turn events as server-sent events. Headers go out when the turn opens the sink. */
const createSseSink = (res: express.Response): SseSink => {
  let isOpen = false;
  return {
    emit: (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    isOpen: () => isOpen,
    open: () => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      isOpen = true;
    },
  };
};

export const addGptRoutes = (router: express.Router, options: GptRouteOptions): void => {
  const {mcpService, tools: routeTools, createRequestTools} = options;
  const askKinds = resolveAskKinds(options.asks);
  if (options.uiBlocks) {
    const uiBlocks = options.uiBlocks === true ? {} : options.uiBlocks;
    configureAiDatasets({
      datasetMaxRows: uiBlocks.datasetMaxRows,
      datasetTtlDays: uiBlocks.datasetTtlDays,
    });
    addGptDatasetRoutes(router, {openApiOptions: options.openApiOptions});
    addGptActionRoutes(router, options);
  }
  if (askKinds.length > 0) {
    assertNoReservedToolNames(routeTools);
  }
  const resumePollIntervalMs =
    options.streamResumePollIntervalMs ?? DEFAULT_STREAM_RESUME_POLL_INTERVAL_MS;
  const staleAfterMs = options.streamStaleAfterMs ?? DEFAULT_STREAM_STALE_AFTER_MS;

  router.post(
    "/gpt/prompt",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Stream a GPT chat response")
        .withRequestBody({
          ...(askKinds.length > 0 ? {askResponse: ASK_RESPONSE_BODY} : {}),
          attachments: {
            items: {
              properties: {
                filename: {type: "string"},
                mimeType: {type: "string"},
                type: {type: "string"},
                url: {type: "string"},
              },
              type: "object",
            },
            type: "array",
          },
          historyId: {type: "string"},
          model: {type: "string"},
          projectId: {type: "string"},
          prompt: {type: "string"},
          surface: SURFACE_BODY,
          systemPrompt: {type: "string"},
        })
        .withResponse(200, {data: {type: "string"}})
        .build(),
    ],
    // Use a raw handler instead of asyncHandler so we can control error responses
    // for both pre-stream (JSON) and mid-stream (SSE) errors.
    async (req: express.Request, res: express.Response) => {
      const sink = createSseSink(res);
      try {
        await runChatTurn({body: req.body ?? {}, options, req, sink});
        res.end();
      } catch (error) {
        // Catch-all for errors thrown before or after SSE streaming
        const message = error instanceof Error ? error.message : String(error);
        const status = isAPIError(error) ? error.status : 500;
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error("GPT prompt handler error", {error: message, stack, status});

        if (sink.isOpen()) {
          // Already sent SSE headers — send error as SSE event
          res.write(`data: ${JSON.stringify({error: message})}\n\n`);
          res.end();
          return;
        }
        // Haven't started SSE — send a normal JSON error response
        const fields = isAPIError(error) ? error.meta?.fields : undefined;
        res.status(status).json({
          detail: (isAPIError(error) ? error.detail : undefined) ?? message,
          ...(fields ? {fields} : {}),
          status,
          title: isAPIError(error) ? error.title : "Internal server error",
        });
      }
    }
  );

  // Re-attach to a reply that /gpt/prompt is still streaming (e.g. after a reload or remount).
  // Polls the persisted partial output, so it works across server instances.
  router.get(
    "/gpt/histories/:id/stream",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Resume an in-flight GPT reply as SSE")
        .withPathParameter("id", {type: "string"})
        .withQueryParameter(
          "streamId",
          {type: "string"},
          {description: "Reply to follow. Defaults to the latest streaming reply."}
        )
        .withQueryParameter(
          "offset",
          {type: "number"},
          {description: "Characters of the reply the client already shows. Defaults to 0."}
        )
        .withResponse(200, {data: {type: "string"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const {id} = req.params;
      const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;
      const requestedStreamId =
        typeof req.query.streamId === "string" ? req.query.streamId : undefined;
      const parsedOffset = Number(req.query.offset ?? 0);
      const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

      const history = await GptHistory.findById(id);
      if (!history) {
        throw new APIError({status: 404, title: "History not found"});
      }
      if (history.userId.toString() !== userId?.toString()) {
        throw new APIError({status: 403, title: "Not authorized to access this history"});
      }

      const reply = requestedStreamId
        ? history.prompts.find((p) => p.streamId === requestedStreamId)
        : history.prompts.findLast((p) => p.status === "streaming");
      const streamId = reply?.streamId;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(sseEvent({historyId: id, resumed: true, ...(streamId ? {streamId} : {})}));

      let isClosed = false;
      req.on("close", () => {
        isClosed = true;
      });

      let isInitialPoll = true;
      let sentText: string | undefined;
      let sentLength = offset;
      try {
        while (!isClosed) {
          const current = streamId ? await GptHistory.findById(id) : history;
          if (!current) {
            res.write(sseEvent({error: "History not found"}));
            break;
          }
          const currentReply = streamId
            ? current.prompts.find((p) => p.streamId === streamId)
            : undefined;
          const text = currentReply?.text ?? "";

          if (isInitialPoll && offset > 0) {
            // The client can have loaded a stale placeholder before reconnecting.
            res.write(sseEvent({replace: true, text}));
          } else if (sentText !== undefined && !text.startsWith(sentText)) {
            // Text from a step that turned into a tool call was discarded; resend the reply
            res.write(sseEvent({replace: true, text}));
          } else if (text.length > sentLength) {
            res.write(sseEvent({text: text.slice(sentLength)}));
          }
          isInitialPoll = false;
          sentText = text;
          sentLength = text.length;

          if (currentReply?.status === "streaming") {
            const sinceUpdateMs = DateTime.now()
              .diff(DateTime.fromJSDate(current.updated))
              .toMillis();
            if (sinceUpdateMs > staleAfterMs) {
              await GptHistory.updateOne(
                {_id: current._id, prompts: {$elemMatch: {status: "streaming", streamId}}},
                {$set: {"prompts.$.status": "error"}}
              );
              res.write(sseEvent({error: "The reply was interrupted before it finished"}));
              res.write(sseEvent({done: true, historyId: id}));
              break;
            }
            await sleep(resumePollIntervalMs);
            continue;
          }

          for (const part of currentReply?.content ?? []) {
            if (part.type === "image") {
              res.write(sseEvent({image: {mimeType: part.mimeType, url: part.url}}));
            }
          }
          if (currentReply?.status === "error") {
            res.write(sseEvent({error: "The reply was interrupted before it finished"}));
          }
          res.write(
            sseEvent({done: true, historyId: id, ...(current.title ? {title: current.title} : {})})
          );
          break;
        }
      } catch (error) {
        logger.error("Error resuming GPT stream", {
          error: error instanceof Error ? error.message : String(error),
        });
        res.write(sseEvent({error: error instanceof Error ? error.message : "Unknown error"}));
      }
      res.end();
    })
  );

  router.patch(
    "/gpt/histories/:id/rating",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Rate a prompt in a GPT history")
        .withPathParameter("id", {type: "string"})
        .withRequestBody({
          promptIndex: {type: "number"},
          rating: {type: "string"},
        })
        .withResponse(200, {data: {type: "object"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const {id} = req.params;
      const {promptIndex, rating} = req.body;
      const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

      if (typeof promptIndex !== "number" || !Number.isInteger(promptIndex) || promptIndex < 0) {
        throw new APIError({status: 400, title: "promptIndex must be a non-negative number"});
      }
      if (rating !== null && rating !== "up" && rating !== "down") {
        throw new APIError({status: 400, title: "rating must be 'up', 'down', or null"});
      }

      const history = await GptHistory.findById(id);
      if (!history) {
        throw new APIError({status: 404, title: "History not found"});
      }
      if (history.userId.toString() !== userId?.toString()) {
        throw new APIError({status: 403, title: "Not authorized to access this history"});
      }
      if (promptIndex >= history.prompts.length) {
        throw new APIError({status: 400, title: "promptIndex out of range"});
      }

      // One field update, so rows a running turn appends meanwhile are kept.
      const ratingPath = `prompts.${promptIndex}.rating`;
      await GptHistory.updateOne(
        {_id: history._id},
        rating === null ? {$unset: {[ratingPath]: ""}} : {$set: {[ratingPath]: rating}}
      );

      return res.json({data: {promptIndex, rating}});
    })
  );

  router.post(
    "/gpt/remix",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Remix text")
        .withRequestBody({
          text: {type: "string"},
        })
        .withResponse(200, {data: {type: "string"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const {text} = req.body;
      const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

      if (!text || typeof text !== "string") {
        throw new APIError({status: 400, title: "text is required"});
      }

      const aiService = resolveAiService(req, options);
      if (!aiService) {
        return res.json({data: DEMO_RESPONSE});
      }

      const result = await aiService.generateRemix({text, userId});
      return res.json({data: result});
    })
  );

  router.get(
    "/gpt/tools",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("List available AI tools")
        .withResponse(200, {
          data: {
            items: {
              properties: {
                description: {type: "string"},
                name: {type: "string"},
                source: {type: "string"},
              },
              type: "object",
            },
            type: "array",
          },
        })
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const tools: Array<{name: string; description: string; source: string}> = [];

      // Static tools from route config
      if (routeTools) {
        for (const [name, t] of Object.entries(routeTools)) {
          tools.push({
            description: (t as {description?: string}).description ?? "",
            name,
            source: "builtin",
          });
        }
      }

      // Per-request tools
      if (createRequestTools) {
        const requestTools = createRequestTools(req);
        for (const [name, t] of Object.entries(requestTools)) {
          tools.push({
            description: (t as {description?: string}).description ?? "",
            name,
            source: "builtin",
          });
        }
      }

      // MCP tools
      if (mcpService) {
        try {
          const mcpTools = await mcpService.getTools();
          for (const [name, t] of Object.entries(mcpTools)) {
            tools.push({
              description: (t as {description?: string}).description ?? "",
              name,
              source: "mcp",
            });
          }
        } catch {
          // MCP tool discovery failure should not break the request
        }
      }

      return res.json({data: tools});
    })
  );
};
