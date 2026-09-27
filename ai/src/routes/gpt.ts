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
import type mongoose from "mongoose";

import {GptHistory} from "../models/gptHistory";
import {assertNoReservedToolNames, resolveAskKinds} from "../service/asks";
import {type ChatTurnSink, DEMO_RESPONSE, resolveAiService, runChatTurn} from "../service/chatTurn";
import type {GptRouteOptions} from "../types";

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
  if (askKinds.length > 0) {
    assertNoReservedToolNames(routeTools);
  }

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

      if (typeof promptIndex !== "number" || promptIndex < 0) {
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

      if (rating === null) {
        history.prompts[promptIndex].rating = undefined;
      } else {
        history.prompts[promptIndex].rating = rating;
      }
      history.markModified("prompts");
      await history.save();

      return res.json({data: {promptIndex, rating: history.prompts[promptIndex].rating ?? null}});
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
