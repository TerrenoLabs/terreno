import {randomUUID} from "node:crypto";
import {
  APIError,
  asyncHandler,
  authenticateMiddleware,
  createOpenApiBuilder,
  logger,
} from "@terreno/api";
import type {Tool} from "ai";
import {stepCountIs, streamText} from "ai";
import type express from "express";
import {DateTime} from "luxon";
import type mongoose from "mongoose";
import {createTelemetryConfig, preparePromptForAI} from "../langfuseVercelAi";

import {GptHistory} from "../models/gptHistory";
import {Project} from "../models/project";
import type {SpanRecord} from "../observability/types";
import {AIService} from "../service/aiService";
import type {FileStorageService} from "../service/fileStorage";
import {assertFileUploadsEnabled} from "../service/fileUploadsGate";
import {TITLE_GENERATION_PROMPT} from "../service/prompts";
import type {
  GptHistoryDocument,
  GptHistoryPrompt,
  GptRouteOptions,
  MessageContentPart,
} from "../types";

const DEFAULT_STREAM_PERSIST_INTERVAL_MS = 1000;
const DEFAULT_STREAM_RESUME_POLL_INTERVAL_MS = 500;
const DEFAULT_STREAM_STALE_AFTER_MS = 60_000;
// Bump `updated` even without new text so long tool calls do not look stale to resumers
const STREAM_HEARTBEAT_MS = 10_000;

const DURABLE_URL_PATTERN = /^(https?:|data:)/i;
const DATA_URL_PATTERN = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s;

interface PromptAttachment {
  filename?: string;
  mimeType?: string;
  type?: string;
  url?: string;
}

interface AttachmentContentParts {
  /** Parts sent to the model for this request (original URLs, including data URLs). */
  modelParts: MessageContentPart[];
  /** Parts persisted to history (durable storage references when storage is configured). */
  storedParts: MessageContentPart[];
}

const sseEvent = (payload: Record<string, unknown>): string =>
  `data: ${JSON.stringify(payload)}\n\n`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Reject attachment URLs that only exist on the client (blob:, file:, content:, ph:, ...).
 * They cannot be read by the model provider or reloaded from history later.
 */
const validateAttachments = (attachments: unknown): PromptAttachment[] => {
  if (attachments === undefined || attachments === null) {
    return [];
  }
  if (!Array.isArray(attachments)) {
    throw new APIError({status: 400, title: "attachments must be an array"});
  }
  for (const attachment of attachments as PromptAttachment[]) {
    if (attachment?.type !== "image" && attachment?.type !== "file") {
      continue;
    }
    if (typeof attachment.url !== "string" || !DURABLE_URL_PATTERN.test(attachment.url)) {
      const scheme =
        typeof attachment.url === "string" ? (attachment.url.split(":")[0] ?? "") : "missing";
      throw new APIError({
        detail:
          `Attachment "${attachment.filename ?? attachment.type}" uses a "${scheme}" URL. ` +
          "Upload the file first (POST /files/upload) or send it as a data: URL.",
        status: 400,
        title: "Attachment URL must be an http(s) or data: URL",
      });
    }
  }
  return attachments as PromptAttachment[];
};

const decodeDataUrl = (url: string): {buffer: Buffer; mimeType?: string} | undefined => {
  const match = DATA_URL_PATTERN.exec(url);
  if (!match) {
    return undefined;
  }
  const [, mimeType, , base64Flag, payload] = match;
  const buffer = base64Flag
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return {buffer, mimeType: mimeType || undefined};
};

/** Build model and history content parts, uploading data: attachments when storage is configured. */
const buildAttachmentParts = async ({
  attachments,
  fileStorageService,
  userId,
}: {
  attachments: PromptAttachment[];
  fileStorageService?: FileStorageService;
  userId?: mongoose.Types.ObjectId;
}): Promise<AttachmentContentParts> => {
  const modelParts: MessageContentPart[] = [];
  const storedParts: MessageContentPart[] = [];
  for (const attachment of attachments) {
    if (attachment.type !== "image" && attachment.type !== "file") {
      continue;
    }
    const url = attachment.url as string;
    const modelPart: MessageContentPart =
      attachment.type === "image"
        ? {mimeType: attachment.mimeType, type: "image", url}
        : {
            filename: attachment.filename,
            mimeType: attachment.mimeType as string,
            type: "file",
            url,
          };
    modelParts.push(modelPart);

    const decoded = url.startsWith("data:") ? decodeDataUrl(url) : undefined;
    if (!fileStorageService || !userId || !decoded) {
      storedParts.push(modelPart);
      continue;
    }
    const mimeType = attachment.mimeType ?? decoded.mimeType ?? "application/octet-stream";
    const extension = mimeType.split("/")[1]?.split("+")[0] ?? "bin";
    try {
      const uploaded = await fileStorageService.upload({
        buffer: decoded.buffer,
        filename: attachment.filename ?? `attachment-${DateTime.now().toMillis()}.${extension}`,
        mimeType,
        userId,
      });
      storedParts.push({...modelPart, gcsKey: uploaded.gcsKey, url: uploaded.url});
    } catch (error) {
      throw new APIError({
        cause: error,
        detail: error instanceof Error ? error.message : String(error),
        status: 502,
        title: "Attachment upload failed",
      });
    }
  }
  return {modelParts, storedParts};
};

const toPlainPrompt = (prompt: GptHistoryPrompt): GptHistoryPrompt => {
  const maybeSubdoc = prompt as GptHistoryPrompt & {toObject?: () => GptHistoryPrompt};
  return typeof maybeSubdoc.toObject === "function" ? maybeSubdoc.toObject() : prompt;
};

/** Swap stored attachment references for short-lived signed URLs the model provider can fetch. */
const resolveStoredAttachmentUrls = async (
  prompts: GptHistoryPrompt[],
  fileStorageService?: FileStorageService
): Promise<GptHistoryPrompt[]> => {
  if (!fileStorageService) {
    return prompts;
  }
  return Promise.all(
    prompts.map(async (prompt) => {
      if (!prompt.content?.some((part) => part.type !== "text" && part.gcsKey)) {
        return prompt;
      }
      const plain = toPlainPrompt(prompt);
      const content = await Promise.all(
        (plain.content ?? []).map(async (part) => {
          if (part.type === "text" || !part.gcsKey) {
            return part;
          }
          try {
            return {...part, url: await fileStorageService.getSignedUrl(part.gcsKey)};
          } catch (error) {
            logger.warn("Could not sign stored attachment URL", {
              error: error instanceof Error ? error.message : String(error),
              gcsKey: part.gcsKey,
            });
            return part;
          }
        })
      );
      return {...plain, content};
    })
  );
};

interface GeneratedImageFile {
  base64: string;
  mediaType: string;
}

const isGeneratedImageFile = (value: unknown): value is GeneratedImageFile =>
  typeof value === "object" &&
  value !== null &&
  "base64" in value &&
  typeof value.base64 === "string" &&
  "mediaType" in value &&
  typeof value.mediaType === "string" &&
  value.mediaType.startsWith("image/");

const DEMO_RESPONSE =
  "This is demo mode. To use AI features, paste your Gemini API key in Settings.";

const readSessionId = (req: express.Request): string | undefined => {
  const fromBody = req.body?.sessionId;
  if (typeof fromBody === "string" && fromBody.length > 0) {
    return fromBody;
  }
  const header = req.headers["x-ai-session-id"];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  if (Array.isArray(header) && typeof header[0] === "string" && header[0].length > 0) {
    return header[0];
  }
  return undefined;
};

const readSensitiveOverride = (value: unknown): boolean | undefined => {
  if (value === true) {
    return true;
  }
  return undefined;
};

const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
};

const toIsoUtc = (millis: number): string => {
  return DateTime.fromMillis(millis, {zone: "utc"}).toISO() ?? "";
};

interface PendingToolCall {
  args: unknown;
  spanId: string;
  startedAt: number;
  toolName: string;
}

const readAdminPromptReference = ({
  promptLabel,
  promptName,
  user,
}: {
  promptLabel: unknown;
  promptName: unknown;
  user?: {admin?: boolean};
}): {promptLabel?: string; promptName?: string} => {
  const name = readOptionalString(promptName);
  const label = readOptionalString(promptLabel);
  if (!name && !label) {
    return {};
  }
  if (!user?.admin) {
    throw new APIError({status: 403, title: "Prompt registry selection requires admin access"});
  }
  return {promptLabel: label, promptName: name};
};

/** Send a canned SSE demo response when no AI service is available. */
const sendDemoResponse = (res: express.Response, historyId?: string): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`data: ${JSON.stringify({text: DEMO_RESPONSE})}\n\n`);
  res.write(`data: ${JSON.stringify({done: true, ...(historyId ? {historyId} : {})})}\n\n`);
  res.end();
};

/**
 * Resolve the AIService for a request. Priority:
 * 1. Per-request API key via `x-ai-api-key` header (creates a temporary AIService via createModelFn)
 * 2. Specific model requested + server-side model factory (creates a temporary AIService via createServerModelFn)
 * 3. Pre-configured aiService from route options
 * 4. undefined (triggers demo mode response)
 */
const resolveAiService = (
  req: express.Request,
  options: GptRouteOptions,
  modelId?: string
): AIService | undefined => {
  const perRequestKey = req.headers["x-ai-api-key"] as string | undefined;
  if (perRequestKey && options.createModelFn) {
    return new AIService({model: options.createModelFn(perRequestKey, modelId)});
  }
  if (modelId && options.createServerModelFn) {
    const serverModel = options.createServerModelFn(modelId);
    if (serverModel) {
      return new AIService({model: serverModel});
    }
  }
  return options.aiService;
};

/** Generate a short title for a conversation using a cheap model call. */
const generateTitle = async (
  prompt: string,
  response: string,
  aiService: AIService,
  options: GptRouteOptions,
  perRequestApiKey?: string
): Promise<string | undefined> => {
  try {
    let titleService = aiService;
    if (options.titleModelId) {
      if (options.createModelFn && perRequestApiKey) {
        titleService = new AIService({
          model: options.createModelFn(perRequestApiKey, options.titleModelId),
        });
      } else if (options.createServerModelFn) {
        const titleModel = options.createServerModelFn(options.titleModelId);
        if (titleModel) {
          titleService = new AIService({model: titleModel});
        }
      }
    }
    const conversationSnippet = `User: ${prompt}\nAssistant: ${response.substring(0, 500)}`;
    const title = await titleService.generateText({
      prompt: conversationSnippet,
      skipTrace: true,
      systemPrompt: TITLE_GENERATION_PROMPT,
      temperature: 0.3,
    });
    return title.trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
};

export const addGptRoutes = (router: express.Router, options: GptRouteOptions): void => {
  const {
    mcpService,
    tools: routeTools,
    createRequestTools,
    toolChoice,
    maxSteps,
    fileStorageService,
  } = options;
  const persistIntervalMs = options.streamPersistIntervalMs ?? DEFAULT_STREAM_PERSIST_INTERVAL_MS;
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
          promptLabel: {type: "string"},
          promptName: {type: "string"},
          sensitive: {type: "boolean"},
          sessionId: {type: "string"},
          systemPrompt: {type: "string"},
        })
        .withResponse(200, {data: {type: "string"}})
        .build(),
    ],
    // Use a raw handler instead of asyncHandler so we can control error responses
    // for both pre-stream (JSON) and mid-stream (SSE) errors.
    async (req: express.Request, res: express.Response) => {
      let sseStarted = false;
      try {
        const {
          prompt,
          historyId,
          systemPrompt,
          attachments,
          model: requestModel,
          projectId,
          promptLabel,
          promptName,
          sensitive,
          sessionId: bodySessionId,
        } = req.body;
        const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;
        const sessionId = readOptionalString(bodySessionId) ?? readSessionId(req);
        const sensitiveOverride = readSensitiveOverride(sensitive);
        const promptReference = readAdminPromptReference({
          promptLabel,
          promptName,
          user: req.user as {admin?: boolean} | undefined,
        });

        if (!prompt || typeof prompt !== "string") {
          throw new APIError({status: 400, title: "prompt is required"});
        }
        if (Array.isArray(attachments) && attachments.length > 0) {
          await assertFileUploadsEnabled(req, options.fileUploadsEnabled);
        }
        const validAttachments = validateAttachments(attachments);

        // Resolve AI service (per-request key takes priority, then configured service)
        const hasPerRequestKey = !!req.headers["x-ai-api-key"];
        const hasCreateModelFn = !!options.createModelFn;
        const hasConfiguredService = !!options.aiService;
        logger.debug("Resolving AI service", {
          hasConfiguredService,
          hasCreateModelFn,
          hasPerRequestKey,
        });

        const aiService = resolveAiService(req, options, requestModel);
        if (!aiService) {
          logger.debug("No AI service available, sending demo response");
          return sendDemoResponse(res);
        }

        // Load or create history
        let history: GptHistoryDocument | null;
        if (historyId) {
          history = await GptHistory.findById(historyId);
          if (!history) {
            throw new APIError({status: 404, title: "History not found"});
          }
          if (history.userId.toString() !== userId?.toString()) {
            throw new APIError({status: 403, title: "Not authorized to access this history"});
          }
        } else {
          history = new GptHistory({prompts: [], userId, ...(projectId ? {projectId} : {})});
        }

        // If history doesn't have a projectId yet but one was provided, associate it
        if (projectId && !history.projectId) {
          history.projectId = projectId;
        }

        // Load project context if a projectId is provided (or inherited from history)
        const effectiveProjectId = projectId ?? history.projectId;
        let effectiveSystemPrompt = systemPrompt;
        if (effectiveProjectId) {
          try {
            const project = await Project.findById(effectiveProjectId);
            if (project && project.userId.toString() === userId?.toString()) {
              const parts: string[] = [];
              if (project.systemContext) {
                parts.push(project.systemContext);
              }
              if (project.memories.length > 0) {
                parts.push(
                  `## Relevant Memories\n${project.memories.map((m) => `- ${m.text}`).join("\n")}`
                );
              }
              if (parts.length > 0) {
                const projectContext = parts.join("\n\n");
                effectiveSystemPrompt = effectiveSystemPrompt
                  ? `${projectContext}\n\n${effectiveSystemPrompt}`
                  : projectContext;
              }
            }
          } catch {
            // Project loading failure should not block the request
          }
        }

        // Load system prompt from Langfuse if configured
        if (options.langfuseSystemPromptName) {
          try {
            const langfuseResult = await preparePromptForAI({
              promptName: options.langfuseSystemPromptName,
              userId: userId?.toString(),
            });
            const langfusePrompt =
              typeof langfuseResult.prompt === "string" ? langfuseResult.prompt : undefined;
            if (langfusePrompt) {
              effectiveSystemPrompt = effectiveSystemPrompt
                ? `${langfusePrompt}\n\n${effectiveSystemPrompt}`
                : langfusePrompt;
            }
          } catch (err) {
            logger.debug(`Langfuse system prompt skipped: ${(err as Error).message}`);
          }
        }

        const observability = await aiService.resolveGenerateObservability({
          ...promptReference,
          sensitive: sensitiveOverride,
          sessionId,
          systemPrompt: effectiveSystemPrompt,
        });
        effectiveSystemPrompt = observability.systemPrompt;

        // Build content parts from attachments
        logger.debug("Processing attachments", {
          count: validAttachments.length,
          types: validAttachments.map((a) => ({
            mimeType: a.mimeType,
            type: a.type,
            urlLength: a.url?.length ?? 0,
          })),
        });
        const {modelParts, storedParts} = await buildAttachmentParts({
          attachments: validAttachments,
          fileStorageService,
          userId,
        });
        const contentParts: MessageContentPart[] = [{text: prompt, type: "text"}, ...storedParts];

        // Add user prompt to history
        const hasAttachments = contentParts.length > 1;
        const userPrompt: GptHistoryPrompt = {
          text: prompt,
          type: "user",
          ...(hasAttachments ? {content: contentParts} : {}),
        };
        history.prompts.push(userPrompt);

        // Build messages from history using AIService helper
        logger.debug("Building messages", {
          attachmentCount: contentParts.length - 1,
          historyLength: history.prompts.length,
        });
        // Earlier turns reference stored attachments; this turn sends the original URLs
        const earlierPrompts = await resolveStoredAttachmentUrls(
          history.prompts.slice(0, -1),
          fileStorageService
        );
        const modelUserPrompt: GptHistoryPrompt = hasAttachments
          ? {...userPrompt, content: [{text: prompt, type: "text"}, ...modelParts]}
          : userPrompt;
        const messages = aiService.buildMessages([...earlierPrompts, modelUserPrompt]);
        logger.debug("Messages built", {messageCount: messages.length});

        // Some models (e.g. gemini-3-pro-image) don't support tool calling
        const modelId = aiService.modelId;
        const supportsTools = !modelId?.includes("image");

        // Merge tools from route config, per-request tools, and MCP service
        let allTools: Record<string, Tool> | undefined;
        const requestTools = createRequestTools ? createRequestTools(req) : undefined;
        if (supportsTools && (routeTools || requestTools || mcpService)) {
          allTools = {...(routeTools ?? {}), ...(requestTools ?? {})};
          if (mcpService) {
            try {
              const mcpTools = await mcpService.getTools();
              Object.assign(allTools, mcpTools);
            } catch {
              // MCP tool discovery failure should not block the request
            }
          }
        }

        // Persist the user turn and a streaming placeholder so a reload can resume the reply
        const streamId = randomUUID();
        history.prompts.push({
          model: aiService.modelId,
          status: "streaming",
          streamId,
          text: "",
          type: "assistant",
        });
        await history.save();
        const savedHistory = history;
        const placeholderIndex = history.prompts.length - 1;

        // Stream response via SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        sseStarted = true;
        res.write(sseEvent({historyId: history._id.toString(), started: true, streamId}));

        let fullResponse = "";
        // Buffer text per step so we can discard reasoning text when a tool call follows
        let stepTextBuffer = "";
        let stepHasToolCall = false;
        const currentPartialText = (): string =>
          fullResponse + (stepHasToolCall ? "" : stepTextBuffer);

        let lastPersistedText = "";
        let lastPersistedAt = DateTime.now();
        let persistQueue: Promise<void> = Promise.resolve();
        const persistTimer = setInterval(() => {
          const text = currentPartialText();
          const isHeartbeatDue =
            DateTime.now().diff(lastPersistedAt).toMillis() >= STREAM_HEARTBEAT_MS;
          if (text === lastPersistedText && !isHeartbeatDue) {
            return;
          }
          lastPersistedText = text;
          lastPersistedAt = DateTime.now();
          persistQueue = persistQueue
            .then(async () => {
              await GptHistory.updateOne(
                {_id: savedHistory._id, [`prompts.${placeholderIndex}.streamId`]: streamId},
                {
                  $set: {
                    [`prompts.${placeholderIndex}.text`]: text,
                    updated: DateTime.now().toJSDate(),
                  },
                }
              );
            })
            .catch((persistErr) => {
              logger.warn("Failed to persist partial GPT response", {
                error: persistErr instanceof Error ? persistErr.message : String(persistErr),
              });
            });
        }, persistIntervalMs);
        const stopPersisting = async (): Promise<void> => {
          clearInterval(persistTimer);
          await persistQueue;
        };
        const removePlaceholder = (): void => {
          const index = savedHistory.prompts.findIndex((p) => p.streamId === streamId);
          if (index >= 0) {
            savedHistory.prompts.splice(index, 1);
          }
        };

        const generatedImages: Array<{mimeType: string; url: string}> = [];
        // Stream file parts and result.files report the same images; emit each data URL once.
        const sendGeneratedImage = (file: GeneratedImageFile): void => {
          const url = `data:${file.mediaType};base64,${file.base64}`;
          if (generatedImages.some((img) => img.url === url)) {
            return;
          }
          generatedImages.push({mimeType: file.mediaType, url});
          res.write(`data: ${JSON.stringify({image: {mimeType: file.mediaType, url}})}\n\n`);
        };
        const startTime = DateTime.now().toMillis();
        const pendingToolCalls = new Map<string, PendingToolCall>();
        const toolSpans: SpanRecord[] = [];
        try {
          logger.debug("Starting streamText", {model: modelId, supportsTools});
          const telemetry = createTelemetryConfig({
            functionId: "gpt-prompt",
            metadata: {
              ...(options.langfuseSystemPromptName
                ? {langfusePromptName: options.langfuseSystemPromptName}
                : {}),
            },
            userId: userId?.toString(),
          });
          const result = streamText({
            experimental_telemetry: telemetry,
            messages,
            model: aiService.model,
            providerOptions: !supportsTools
              ? {
                  google: {responseModalities: ["TEXT", "IMAGE"]},
                  vertex: {responseModalities: ["TEXT", "IMAGE"]},
                }
              : undefined,
            stopWhen: allTools ? stepCountIs(maxSteps ?? 5) : stepCountIs(1),
            system: effectiveSystemPrompt ?? undefined,
            temperature: aiService.defaultTemperature,
            toolChoice: allTools ? (toolChoice ?? "auto") : undefined,
            tools: allTools,
          });

          let partCount = 0;

          for await (const part of result.fullStream as AsyncIterable<{
            type: string;
            [key: string]: unknown;
          }>) {
            partCount++;
            if (partCount <= 5 || part.type === "error" || part.type === "file") {
              logger.debug("Stream part", {
                partCount,
                type: part.type,
                ...(part.type === "file" && isGeneratedImageFile(part.file)
                  ? {mediaType: part.file.mediaType}
                  : {}),
                ...(part.type === "error" ? {error: String(part.error ?? part)} : {}),
              });
            }

            // Track step boundaries to discard reasoning text from tool-call steps
            if (part.type === "start-step") {
              stepTextBuffer = "";
              stepHasToolCall = false;
              continue;
            }
            if (part.type === "finish-step") {
              // Only emit buffered text if no tool call happened in this step
              if (!stepHasToolCall && stepTextBuffer) {
                // Strip model reasoning that leaks as JSON action blobs
                const cleaned = stepTextBuffer
                  .replace(/\{[\s\S]*?"action"[\s\S]*?\}\s*$/g, "")
                  .trim();
                if (cleaned) {
                  fullResponse += cleaned;
                  res.write(`data: ${JSON.stringify({text: cleaned})}\n\n`);
                }
              }
              stepTextBuffer = "";
              stepHasToolCall = false;
              continue;
            }

            if (part.type === "error") {
              const errMsg =
                part.error instanceof Error
                  ? part.error.message
                  : String(part.error ?? "Unknown stream error");
              logger.error("AI stream error part", {error: errMsg});
              res.write(`data: ${JSON.stringify({error: errMsg})}\n\n`);
              continue;
            }
            if (part.type === "file") {
              if (isGeneratedImageFile(part.file)) {
                sendGeneratedImage(part.file);
                logger.debug("Sent inline image from stream");
              }
              continue;
            }
            if (part.type === "text-delta") {
              const textChunk = (part.text ?? "") as string;
              if (textChunk) {
                stepTextBuffer += textChunk;
              }
            } else if (part.type === "tool-call") {
              stepHasToolCall = true;
              const toolCallId = part.toolCallId as string;
              const toolName = part.toolName as string;
              const toolStartedAt = DateTime.now().toMillis();
              pendingToolCalls.set(toolCallId, {
                args: part.input,
                spanId: randomUUID(),
                startedAt: toolStartedAt,
                toolName,
              });
              res.write(
                `data: ${JSON.stringify({
                  toolCall: {
                    args: part.input,
                    toolCallId,
                    toolName,
                  },
                })}\n\n`
              );
              // Persist tool call in history
              history.prompts.push({
                args: part.input as Record<string, unknown>,
                text: `Tool call: ${toolName}`,
                toolCallId,
                toolName,
                type: "tool-call",
              });
            } else if (part.type === "tool-result") {
              const toolCallId = part.toolCallId as string;
              const toolName = part.toolName as string;
              const toolResult = part.output as Record<string, unknown> | undefined;

              // If the tool result contains file data, send it as a separate file SSE event
              if (toolResult?.fileData && typeof toolResult.fileData === "string") {
                res.write(
                  `data: ${JSON.stringify({
                    file: {
                      filename: toolResult.filename ?? "document",
                      mimeType: toolResult.mimeType ?? "application/octet-stream",
                      url: toolResult.fileData,
                    },
                  })}\n\n`
                );
                logger.debug("Sent generated file from tool result", {
                  filename: toolResult.filename,
                  mimeType: toolResult.mimeType,
                });
              }

              // Strip fileData from result before sending/storing to avoid bloating the SSE and DB
              const {fileData: _fileData, ...cleanResult} = toolResult ?? {};
              const pending = pendingToolCalls.get(toolCallId);
              const toolEndedAt = DateTime.now().toMillis();
              if (pending) {
                toolSpans.push({
                  durationMs: toolEndedAt - pending.startedAt,
                  endedAt: toIsoUtc(toolEndedAt),
                  id: pending.spanId,
                  input: pending.args,
                  kind: "TOOL",
                  name: pending.toolName,
                  output: cleanResult,
                  startedAt: toIsoUtc(pending.startedAt),
                  startOffsetMs: pending.startedAt - startTime,
                  status: "ok",
                });
                pendingToolCalls.delete(toolCallId);
              }

              res.write(
                `data: ${JSON.stringify({
                  toolResult: {
                    result: cleanResult,
                    toolCallId,
                    toolName,
                  },
                })}\n\n`
              );
              // Persist tool result in history (without the large file data)
              history.prompts.push({
                result: cleanResult as unknown,
                text: `Tool result: ${toolName}`,
                toolCallId,
                toolName,
                type: "tool-result",
              });
            }
          }

          // Flush any remaining buffered text from the last step
          if (!stepHasToolCall && stepTextBuffer) {
            const cleaned = stepTextBuffer.replace(/\{[\s\S]*?"action"[\s\S]*?\}\s*$/g, "").trim();
            if (cleaned) {
              fullResponse += cleaned;
              res.write(`data: ${JSON.stringify({text: cleaned})}\n\n`);
            }
          }

          logger.debug("Stream completed", {fullResponseLength: fullResponse.length, partCount});

          // Catch generated images the stream did not report as file parts
          try {
            const files = await result.files;
            if (files && files.length > 0) {
              for (const file of files) {
                if (isGeneratedImageFile(file)) {
                  sendGeneratedImage(file);
                }
              }
              logger.debug("Sent generated images", {count: generatedImages.length});
            }
          } catch (fileErr) {
            logger.debug("No files in response", {
              error: fileErr instanceof Error ? fileErr.message : String(fileErr),
            });
          }

          // Replace the streaming placeholder with the final reply, after any tool turns
          await stopPersisting();
          removePlaceholder();
          if (fullResponse || generatedImages.length > 0) {
            const contentParts: MessageContentPart[] = generatedImages.map((img) => ({
              mimeType: img.mimeType,
              type: "image" as const,
              url: img.url,
            }));
            const assistantPrompt: GptHistoryPrompt = {
              model: aiService.modelId,
              status: "complete",
              streamId,
              text: fullResponse,
              type: "assistant",
              ...(contentParts.length > 0 ? {content: contentParts} : {}),
            };
            history.prompts.push(assistantPrompt);
          }
          history.markModified("prompts");
          await history.save();

          try {
            await aiService.recordGenerate({
              childSpans: toolSpans.length > 0 ? toolSpans : undefined,
              observability,
              prompt,
              requestType: "general",
              response: fullResponse,
              responseTime: DateTime.now().toMillis() - startTime,
              startTime,
              userId: userId ?? undefined,
            });
          } catch (logErr) {
            logger.warn("Failed to log AIRequest", {
              error: logErr instanceof Error ? logErr.message : String(logErr),
            });
          }

          // Generate a title for new conversations using a cheap model call
          if (!history.title && fullResponse) {
            const perRequestApiKey = req.headers["x-ai-api-key"] as string | undefined;
            const title = await generateTitle(
              prompt,
              fullResponse,
              aiService,
              options,
              perRequestApiKey
            );
            if (title) {
              history.title = title;
              await history.save();
            }
          }

          logger.debug("Sending done event", {
            fullResponseLength: fullResponse.length,
            historyId: history._id.toString(),
          });
          res.write(
            `data: ${JSON.stringify({
              done: true,
              historyId: history._id.toString(),
              ...(history.title ? {title: history.title} : {}),
            })}\n\n`
          );
          res.end();
        } catch (error) {
          logger.error("Error in GPT stream", {
            error: error instanceof Error ? error.message : String(error),
          });

          // Keep any partial reply so the conversation shows what streamed before the failure
          try {
            await stopPersisting();
            const partialText = currentPartialText();
            const placeholder = savedHistory.prompts.find((p) => p.streamId === streamId);
            if (placeholder?.status === "streaming") {
              if (partialText) {
                placeholder.text = partialText;
                placeholder.status = "error";
              } else {
                removePlaceholder();
              }
              savedHistory.markModified("prompts");
              await savedHistory.save();
            }
          } catch (saveErr) {
            logger.warn("Failed to save interrupted GPT response", {
              error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            });
          }

          try {
            await aiService.recordGenerate({
              childSpans: toolSpans.length > 0 ? toolSpans : undefined,
              error: error instanceof Error ? error.message : String(error),
              observability,
              prompt,
              requestType: "general",
              response: fullResponse || undefined,
              responseTime: DateTime.now().toMillis() - startTime,
              startTime,
              userId: userId ?? undefined,
            });
          } catch (logErr) {
            logger.warn("Failed to log AIRequest error", {
              error: logErr instanceof Error ? logErr.message : String(logErr),
            });
          }

          res.write(
            `data: ${JSON.stringify({error: error instanceof Error ? error.message : "Unknown error"})}\n\n`
          );
          res.end();
        }
      } catch (outerError) {
        // Catch-all for errors thrown before or after SSE streaming
        const message = outerError instanceof Error ? outerError.message : String(outerError);
        const status = outerError instanceof APIError ? outerError.status : 500;
        const stack = outerError instanceof Error ? outerError.stack : undefined;
        logger.error("GPT prompt handler error", {error: message, stack, status});

        if (sseStarted) {
          // Already sent SSE headers — send error as SSE event
          res.write(`data: ${JSON.stringify({error: message})}\n\n`);
          res.end();
        } else {
          // Haven't started SSE — send a normal JSON error response
          res.status(status).json({
            detail: message,
            status,
            title: outerError instanceof APIError ? outerError.title : "Internal server error",
          });
        }
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
          promptLabel: {type: "string"},
          promptName: {type: "string"},
          sensitive: {type: "boolean"},
          sessionId: {type: "string"},
          text: {type: "string"},
        })
        .withResponse(200, {data: {type: "string"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const {text, promptLabel, promptName, sensitive} = req.body;
      const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;
      const sessionId = readSessionId(req);
      const promptReference = readAdminPromptReference({
        promptLabel,
        promptName,
        user: req.user as {admin?: boolean} | undefined,
      });

      if (!text || typeof text !== "string") {
        throw new APIError({status: 400, title: "text is required"});
      }

      const aiService = resolveAiService(req, options);
      if (!aiService) {
        return res.json({data: DEMO_RESPONSE});
      }

      const result = await aiService.generateRemix({
        ...promptReference,
        sensitive: readSensitiveOverride(sensitive),
        sessionId,
        text,
        userId,
      });
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
