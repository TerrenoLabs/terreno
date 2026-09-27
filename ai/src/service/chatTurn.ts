import {APIError, logger} from "@terreno/api";
import {
  ASK_CANCEL_REASONS,
  ASK_SURFACES,
  type Ask,
  type AskKind,
  type AskResponse,
  type AskSurface,
  askKindsForSurface,
  type SimpleCard,
  type TurnResult,
  toSimpleCard,
  validateAskResponse,
} from "@terreno/blocks";
import type {ModelMessage, Tool} from "ai";
import {stepCountIs, streamText} from "ai";
import type express from "express";
import {DateTime} from "luxon";
import type mongoose from "mongoose";

import {createTelemetryConfig, preparePromptForAI} from "../langfuseVercelAi";
import {AIRequest} from "../models/aiRequest";
import {GptHistory} from "../models/gptHistory";
import {Project} from "../models/project";
import type {
  GptHistoryAskStatus,
  GptHistoryDocument,
  GptHistoryPrompt,
  GptRouteOptions,
  MessageContentPart,
} from "../types";
import {AIService} from "./aiService";
import {
  askKindFromToolName,
  askToolName,
  buildAsksSystemPrompt,
  completePausedTurn,
  createAskTools,
  parseAsk,
  resolveAskKinds,
  toStoredMessages,
  withoutReservedToolNames,
} from "./asks";
import {COMPACT_SURFACE_SYSTEM_PROMPT, TITLE_GENERATION_PROMPT} from "./prompts";

export const DEMO_RESPONSE =
  "This is demo mode. To use AI features, paste your Gemini API key in Settings.";

interface ChatTurnAskEvent {
  ask: Ask & {simple: SimpleCard; toolCallId: string};
  /** The conversation that waits on the ask, so a client can answer before `{done}` arrives. */
  historyId: string;
}

interface ChatTurnAskResolvedEvent {
  askResolved: {action: AskResponse["action"]; toolCallId: string};
}

interface ChatTurnDoneEvent {
  done: true;
  historyId?: string;
  pendingAsk?: {toolCallId: string};
  title?: string;
}

interface ChatTurnErrorEvent {
  error: string;
}

interface ChatTurnFileEvent {
  file: {filename: string; mimeType: string; url: string};
}

interface ChatTurnImageEvent {
  image: {mimeType: string; url: string};
}

interface ChatTurnTextEvent {
  text: string;
}

interface ChatTurnToolCallEvent {
  toolCall: {args: unknown; toolCallId: string; toolName: string};
}

interface ChatTurnToolResultEvent {
  toolResult: {result: unknown; toolCallId: string; toolName: string};
}

type ChatTurnEvent =
  | ChatTurnAskEvent
  | ChatTurnAskResolvedEvent
  | ChatTurnDoneEvent
  | ChatTurnErrorEvent
  | ChatTurnFileEvent
  | ChatTurnImageEvent
  | ChatTurnTextEvent
  | ChatTurnToolCallEvent
  | ChatTurnToolResultEvent;

/** Receives a turn's events. `open` runs once, before the first event. */
export interface ChatTurnSink {
  emit: (event: ChatTurnEvent) => void;
  open: () => void;
}

interface ChatAttachment {
  filename?: string;
  mimeType?: string;
  type?: string;
  url?: string;
}

interface GeneratedImageFile {
  base64: string;
  mediaType: string;
}

interface GeneratedImage {
  mimeType: string;
  url: string;
}

interface AskAnswer {
  response: Record<string, unknown>;
  toolCallId: string;
}

type AskCall = Ask & {toolCallId: string};

interface ResolvedAsk {
  action: AskResponse["action"];
  kind: AskKind;
  toolCallId: string;
}

interface TurnStart {
  history: GptHistoryDocument;
  /** True when the turn starts a conversation, which is inserted with the turn's rows. */
  isNewHistory: boolean;
  logPrompt: string;
  messages: ModelMessage[];
  /**
   * The paused turn's `promptIndex` when this turn answers its ask. A prompt turn's is known only
   * once its rows are appended.
   */
  promptIndex?: number;
  replayedMessages: ModelMessage[];
  resolvedAsk?: ResolvedAsk;
  titlePrompt: string;
  /** The turn's new rows so far: the user's message for a prompt, none for an answer. */
  rows: GptHistoryPrompt[];
}

/** What the turn streamed so far. The rows are appended together when the turn ends or fails. */
interface TurnRecord {
  askCalls: AskCall[];
  fullResponse: string;
  generatedImages: GeneratedImage[];
  rows: GptHistoryPrompt[];
}

type StreamPart = {type: string; [key: string]: unknown};

const isGeneratedImageFile = (value: unknown): value is GeneratedImageFile =>
  typeof value === "object" &&
  value !== null &&
  "base64" in value &&
  typeof value.base64 === "string" &&
  "mediaType" in value &&
  typeof value.mediaType === "string" &&
  value.mediaType.startsWith("image/");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Strip model reasoning that leaks as JSON action blobs
const cleanStepText = (text: string): string =>
  text.replace(/\{[\s\S]*?"action"[\s\S]*?\}\s*$/g, "").trim();

/**
 * Resolve the AIService for a request. Priority:
 * 1. Per-request API key via `x-ai-api-key` header (creates a temporary AIService via createModelFn)
 * 2. Specific model requested + server-side model factory (creates a temporary AIService via createServerModelFn)
 * 3. Pre-configured aiService from route options
 * 4. undefined (triggers demo mode response)
 */
export const resolveAiService = (
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
      systemPrompt: TITLE_GENERATION_PROMPT,
      temperature: 0.3,
    });
    return title.trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
};

const parseAskAnswer = (value: unknown): AskAnswer => {
  if (!isRecord(value)) {
    throw new APIError({status: 400, title: "askResponse must be an object"});
  }
  const {toolCallId, ...response} = value;
  if (typeof toolCallId !== "string" || toolCallId.length === 0) {
    throw new APIError({status: 400, title: "askResponse.toolCallId is required"});
  }
  return {response, toolCallId};
};

/** Checks which kind of turn the body asks for. Throws a 400 when it is neither or both. */
const parseTurnBody = ({
  askKinds,
  body,
}: {
  askKinds: AskKind[];
  body: Record<string, unknown>;
}): AskAnswer | undefined => {
  const {askResponse, attachments, historyId, prompt} = body;
  const hasPrompt = typeof prompt === "string" && prompt.length > 0;
  const askAnswer =
    askKinds.length > 0 && askResponse !== undefined && askResponse !== null
      ? parseAskAnswer(askResponse)
      : undefined;
  if (!askAnswer) {
    if (!hasPrompt) {
      throw new APIError({status: 400, title: "prompt is required"});
    }
    return undefined;
  }
  if (hasPrompt) {
    throw new APIError({status: 400, title: "Send either prompt or askResponse, not both"});
  }
  if (Array.isArray(attachments) && attachments.length > 0) {
    throw new APIError({status: 400, title: "attachments cannot be sent with askResponse"});
  }
  if (!historyId) {
    throw new APIError({status: 400, title: "historyId is required with askResponse"});
  }
  return askAnswer;
};

/** The body's `surface`, `"full"` when it sends none. Throws a 400 for any other value. */
const parseSurface = (surface: unknown): AskSurface => {
  if (surface === undefined || surface === null) {
    return "full";
  }
  const knownSurface = ASK_SURFACES.find((candidate) => candidate === surface);
  if (!knownSurface) {
    throw new APIError({
      detail: `Send one of: ${ASK_SURFACES.join(", ")}.`,
      status: 400,
      title: "surface is not a known surface",
    });
  }
  return knownSurface;
};

const loadHistory = async ({
  historyId,
  projectId,
  userId,
}: {
  historyId: unknown;
  projectId: unknown;
  userId: mongoose.Types.ObjectId | undefined;
}): Promise<GptHistoryDocument> => {
  if (!historyId) {
    return new GptHistory({prompts: [], userId, ...(projectId ? {projectId} : {})});
  }
  const history = await GptHistory.findById(historyId);
  if (!history) {
    throw new APIError({status: 404, title: "History not found"});
  }
  if (history.userId.toString() !== userId?.toString()) {
    throw new APIError({status: 403, title: "Not authorized to access this history"});
  }
  return history;
};

/** The 409 for an answer that names a tool call the conversation is not waiting on. */
export const staleAskError = (toolCallId: string): APIError =>
  new APIError({
    detail: `Tool call ${toolCallId} is not the ask this conversation is waiting on.`,
    status: 409,
    title: "This ask is no longer pending",
  });

/*
 * The ask updates below are pipeline updates because MongoDB rejects `$push` and a positional
 * `$set` on the same array in one update. Values go in through `$literal` so a string that starts
 * with `$` is not read as a field path.
 */

/** Inside a `$map` over `prompts` as `row`: true for the ask's call row while it is pending. */
const isPendingAskCallRow = (toolCallId: string): Record<string, unknown> => ({
  $and: [
    {$eq: ["$$row.type", "tool-call"]},
    {$eq: ["$$row.toolCallId", {$literal: toolCallId}]},
    {$eq: ["$$row.ask.status", "pending"]},
  ],
});

/** `prompts` with the ask's call row marked `status` and its result row appended. */
const promptsWithAskResult = ({
  result,
  status,
  toolCallId,
  toolName,
}: {
  result: AskResponse;
  status: GptHistoryAskStatus;
  toolCallId: string;
  toolName: string;
}): Record<string, unknown> => {
  const resultRow: GptHistoryPrompt = {
    result,
    text: `Tool result: ${toolName}`,
    toolCallId,
    toolName,
    type: "tool-result",
  };
  const markedRow = {
    $mergeObjects: ["$$row", {ask: {$mergeObjects: ["$$row.ask", {status: {$literal: status}}]}}],
  };
  const markedRows = {
    $map: {
      as: "row",
      in: {$cond: [isPendingAskCallRow(toolCallId), markedRow, "$$row"]},
      input: "$prompts",
    },
  };
  return {$concatArrays: [markedRows, [{$literal: resultRow}]]};
};

/**
 * Clears the pending ask, stores its result row, and marks its call row in one atomic update, so
 * an ask resolves once even when two requests answer it at the same time. Returns null when the
 * conversation no longer waits on this ask.
 */
const resolvePendingAsk = async ({
  history,
  result,
  status,
  toolCallId,
  toolName,
}: {
  history: GptHistoryDocument;
  result: AskResponse;
  status: GptHistoryAskStatus;
  toolCallId: string;
  toolName: string;
}): Promise<GptHistoryDocument | null> =>
  GptHistory.findOneAndUpdate(
    {_id: history._id, "pendingAsk.toolCallId": toolCallId},
    [
      {
        $set: {
          prompts: promptsWithAskResult({result, status, toolCallId, toolName}),
          updated: {$literal: DateTime.now().toJSDate()},
        },
      },
      {$unset: "pendingAsk"},
    ],
    {returnDocument: "after", updatePipeline: true}
  );

/** How many times a new message retries cancelling an ask that other requests keep replacing. */
const MAX_CANCEL_ATTEMPTS = 3;

/**
 * Cancels the pending ask because the user sent a message instead of answering. When another
 * request resolves the ask first, the message goes ahead as a normal prompt on the reloaded
 * history, cancelling any ask that took its place.
 */
const cancelPendingAsk = async (
  loaded: GptHistoryDocument
): Promise<{history: GptHistoryDocument; resolvedAsk?: ResolvedAsk}> => {
  let history = loaded;
  for (let attempt = 0; attempt < MAX_CANCEL_ATTEMPTS && history.pendingAsk; attempt++) {
    const {kind, toolCallId} = history.pendingAsk;
    const cancelled = await resolvePendingAsk({
      history,
      result: {action: "cancel", reason: ASK_CANCEL_REASONS.userSentMessage},
      status: "cancelled",
      toolCallId,
      toolName: askToolName(kind),
    });
    if (cancelled) {
      return {history: cancelled, resolvedAsk: {action: "cancel", kind, toolCallId}};
    }
    const reloaded = await GptHistory.findById(history._id);
    if (!reloaded) {
      throw new APIError({status: 404, title: "History not found"});
    }
    history = reloaded;
  }
  if (history.pendingAsk) {
    logger.warn("Sent a message without cancelling an ask that other requests kept replacing", {
      historyId: history._id.toString(),
      toolCallId: history.pendingAsk.toolCallId,
    });
  }
  return {history};
};

/**
 * Appends the turn's rows in one atomic `$push`, so rows another turn saved meanwhile are kept.
 * A new conversation is inserted with its rows instead. Returns the saved history and the index
 * of the turn's first row.
 */
const appendTurnRows = async ({
  history,
  isNewHistory,
  projectId,
  rows,
}: {
  history: GptHistoryDocument;
  isNewHistory: boolean;
  projectId: unknown;
  rows: GptHistoryPrompt[];
}): Promise<{firstRowIndex: number; history: GptHistoryDocument}> => {
  if (isNewHistory) {
    history.prompts.push(...rows);
    await history.save();
    return {firstRowIndex: 0, history};
  }
  if (projectId && !history.projectId) {
    await GptHistory.updateOne({_id: history._id, projectId: null}, {$set: {projectId}});
  }
  if (rows.length === 0) {
    return {firstRowIndex: history.prompts.length, history};
  }
  const saved = await GptHistory.findOneAndUpdate(
    {_id: history._id},
    {$push: {prompts: {$each: rows}}, $set: {updated: DateTime.now().toJSDate()}},
    {returnDocument: "after"}
  );
  if (!saved) {
    throw new APIError({status: 404, title: "History not found"});
  }
  return {firstRowIndex: saved.prompts.length - rows.length, history: saved};
};

/**
 * Stores the generated title unless another turn titled the conversation first, and returns the
 * title the conversation ends up with.
 */
const saveTitle = async ({
  history,
  title,
}: {
  history: GptHistoryDocument;
  title: string;
}): Promise<string | undefined> => {
  const titled = await GptHistory.findOneAndUpdate(
    {_id: history._id, title: {$in: [null, ""]}},
    {$set: {title}},
    {returnDocument: "after"}
  );
  if (titled) {
    return titled.title;
  }
  const current = await GptHistory.findById(history._id);
  return current?.title ?? undefined;
};

/**
 * Makes the ask the conversation's pending ask in one atomic update, unless another turn's ask is
 * already pending: then the ask is answered with `cancel` (`one_ask_at_a_time`) instead, so two
 * turns that pause at the same time cannot overwrite each other. The ask's call row must already
 * be saved. Returns whether the ask became the pending ask.
 */
const claimPendingAsk = async ({
  ask,
  history,
  promptIndex,
  responseMessages,
}: {
  ask: AskCall & {simple: SimpleCard};
  history: GptHistoryDocument;
  /** How many leading rows replay as the paused turn's history, its user message included. */
  promptIndex: number;
  responseMessages: ModelMessage[];
}): Promise<boolean> => {
  const {input, kind, simple, toolCallId} = ask;
  const waitsOnNoAsk = {$eq: [{$ifNull: ["$pendingAsk", null]}, null]};
  const pendingAsk = {
    created: {$literal: DateTime.now().toJSDate()},
    input: {$literal: input},
    kind: {$literal: kind},
    promptIndex: {$literal: promptIndex},
    responseMessages: {$literal: responseMessages},
    simple: {$literal: simple},
    toolCallId: {$literal: toolCallId},
  };
  const cancelledPrompts = promptsWithAskResult({
    result: {action: "cancel", reason: ASK_CANCEL_REASONS.oneAskAtATime},
    status: "cancelled",
    toolCallId,
    toolName: askToolName(kind),
  });
  const saved = await GptHistory.findOneAndUpdate(
    {_id: history._id},
    [
      {
        $set: {
          pendingAsk: {$cond: [waitsOnNoAsk, pendingAsk, "$pendingAsk"]},
          prompts: {$cond: [waitsOnNoAsk, "$prompts", cancelledPrompts]},
        },
      },
    ],
    {returnDocument: "after", updatePipeline: true}
  );
  return saved?.pendingAsk?.toolCallId === toolCallId;
};

const buildContentParts = (prompt: string, attachments: unknown): MessageContentPart[] => {
  const contentParts: MessageContentPart[] = [{text: prompt, type: "text"}];
  if (!attachments || !Array.isArray(attachments)) {
    return contentParts;
  }
  const chatAttachments = attachments as ChatAttachment[];
  logger.debug("Processing attachments", {
    count: chatAttachments.length,
    types: chatAttachments.map((a) => ({
      mimeType: a.mimeType,
      type: a.type,
      urlLength: a.url?.length ?? 0,
    })),
  });
  for (const attachment of chatAttachments) {
    if (attachment.type === "image") {
      contentParts.push({
        mimeType: attachment.mimeType,
        type: "image",
        url: attachment.url as string,
      });
    } else if (attachment.type === "file") {
      contentParts.push({
        filename: attachment.filename,
        mimeType: attachment.mimeType as string,
        type: "file",
        url: attachment.url as string,
      });
    }
  }
  return contentParts;
};

/**
 * Loads the history and prepares the turn's messages. A new prompt first cancels any pending
 * ask. An answer resolves the pending ask and replays the paused turn with the answer appended.
 */
const startTurn = async ({
  aiService,
  askAnswer,
  body,
  userId,
}: {
  aiService: AIService;
  askAnswer: AskAnswer | undefined;
  body: Record<string, unknown>;
  userId: mongoose.Types.ObjectId | undefined;
}): Promise<TurnStart> => {
  const {attachments, historyId, projectId, prompt} = body;
  const loaded = await loadHistory({historyId, projectId, userId});
  const isNewHistory = !historyId;

  if (askAnswer) {
    const history = loaded;
    const pending = history.pendingAsk;
    if (!pending || pending.toolCallId !== askAnswer.toolCallId) {
      throw staleAskError(askAnswer.toolCallId);
    }
    const fields = validateAskResponse({
      input: pending.input,
      kind: pending.kind,
      response: askAnswer.response,
    });
    if (fields.length > 0) {
      throw new APIError({
        detail: "The answer does not match the ask. See fields.",
        meta: {fields},
        status: 400,
        title: "Invalid askResponse",
      });
    }
    const answer = askAnswer.response as AskResponse;
    const {kind, promptIndex, responseMessages, toolCallId} = pending;
    const resolved = await resolvePendingAsk({
      history,
      result: answer,
      status: answer.action === "cancel" ? "cancelled" : "answered",
      toolCallId,
      toolName: askToolName(kind),
    });
    if (!resolved) {
      throw staleAskError(toolCallId);
    }
    const turnHistory = resolved.prompts.slice(0, promptIndex);
    const replayedMessages = completePausedTurn({answer, responseMessages, toolCallId});
    return {
      history: resolved,
      isNewHistory: false,
      logPrompt: JSON.stringify(answer),
      messages: [...aiService.buildMessages(turnHistory), ...replayedMessages],
      promptIndex,
      replayedMessages,
      resolvedAsk: {action: answer.action, kind, toolCallId},
      rows: [],
      titlePrompt: lastUserText(turnHistory),
    };
  }

  const {history, resolvedAsk} = await cancelPendingAsk(loaded);

  // If history doesn't have a projectId yet but one was provided, associate it
  if (isNewHistory && projectId) {
    history.projectId = projectId as mongoose.Types.ObjectId;
  }

  const promptText = prompt as string;
  const contentParts = buildContentParts(promptText, attachments);
  const hasAttachments = contentParts.length > 1;
  const userRow: GptHistoryPrompt = {
    text: promptText,
    type: "user",
    ...(hasAttachments ? {content: contentParts} : {}),
  };

  logger.debug("Building messages", {
    attachmentCount: contentParts.length - 1,
    historyLength: history.prompts.length + 1,
  });
  const messages = aiService.buildMessages([...history.prompts, userRow]);
  logger.debug("Messages built", {messageCount: messages.length});
  return {
    history,
    isNewHistory,
    logPrompt: promptText,
    messages,
    replayedMessages: [],
    resolvedAsk,
    rows: [userRow],
    titlePrompt: promptText,
  };
};

const lastUserText = (prompts: GptHistoryPrompt[]): string =>
  prompts.findLast((prompt) => prompt.type === "user")?.text ?? "";

/** The request's system prompt with project context and the Langfuse prompt prepended. */
const buildSystemPrompt = async ({
  history,
  options,
  projectId,
  systemPrompt,
  userId,
}: {
  history: GptHistoryDocument;
  options: GptRouteOptions;
  projectId: unknown;
  systemPrompt: unknown;
  userId: mongoose.Types.ObjectId | undefined;
}): Promise<string | undefined> => {
  const effectiveProjectId = projectId ?? history.projectId;
  let effectiveSystemPrompt = systemPrompt as string | undefined;
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
  return effectiveSystemPrompt;
};

/** Route, per-request, and MCP tools, plus the ask tools when asks are offered. */
const collectTools = async ({
  askKinds,
  options,
  req,
  supportsTools,
  surface,
}: {
  askKinds: AskKind[];
  options: GptRouteOptions;
  req: express.Request;
  supportsTools: boolean;
  surface: AskSurface;
}): Promise<Record<string, Tool> | undefined> => {
  const {createRequestTools, mcpService, tools: routeTools} = options;
  const requestTools = createRequestTools ? createRequestTools(req) : undefined;
  if (!supportsTools || (!routeTools && !requestTools && !mcpService && askKinds.length === 0)) {
    return undefined;
  }
  const allTools: Record<string, Tool> = {...(routeTools ?? {}), ...(requestTools ?? {})};
  if (mcpService) {
    try {
      const mcpTools = await mcpService.getTools();
      Object.assign(allTools, mcpTools);
    } catch {
      // MCP tool discovery failure should not block the request
    }
  }
  if (askKinds.length === 0) {
    return allTools;
  }
  return {...withoutReservedToolNames(allTools), ...createAskTools({kinds: askKinds, surface})};
};

/**
 * The system prompt with the asks section when asks are offered and the compact line on the
 * compact surface. Without either, it is the request's system prompt unchanged.
 */
const withTurnSystemPrompt = ({
  askKinds,
  surface,
  systemPrompt,
}: {
  askKinds: AskKind[];
  surface: AskSurface;
  systemPrompt: string | undefined;
}): string | undefined => {
  const sections = [
    ...(askKinds.length > 0 ? [buildAsksSystemPrompt({kinds: askKinds, surface})] : []),
    ...(surface === "compact" ? [COMPACT_SURFACE_SYSTEM_PROMPT] : []),
  ];
  if (sections.length === 0) {
    return systemPrompt;
  }
  return [systemPrompt, ...sections].filter(Boolean).join("\n\n");
};

/**
 * Forwards the model stream to the sink and records what it sent in `record`, which stays valid
 * when the stream fails partway. Ask calls are collected, not forwarded: an invalid one goes back
 * to the model as a tool error, and a valid one pauses the turn.
 */
const consumeStream = async ({
  askKinds,
  record,
  result,
  sink,
}: {
  askKinds: AskKind[];
  record: TurnRecord;
  result: ReturnType<typeof streamText>;
  sink: ChatTurnSink;
}): Promise<void> => {
  const {askCalls, generatedImages} = record;
  let partCount = 0;
  // Buffer text per step so we can discard reasoning text when a tool call follows
  let stepTextBuffer = "";
  let stepHasToolCall = false;

  for await (const part of result.fullStream as AsyncIterable<StreamPart>) {
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
        const cleaned = cleanStepText(stepTextBuffer);
        if (cleaned) {
          record.fullResponse += cleaned;
          sink.emit({text: cleaned});
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
      sink.emit({error: errMsg});
      continue;
    }
    if (part.type === "file") {
      if (isGeneratedImageFile(part.file)) {
        const dataUrl = `data:${part.file.mediaType};base64,${part.file.base64}`;
        generatedImages.push({mimeType: part.file.mediaType, url: dataUrl});
        sink.emit({image: {mimeType: part.file.mediaType, url: dataUrl}});
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
      const toolName = part.toolName as string;
      const toolCallId = part.toolCallId as string;
      const askKind = askKindFromToolName(toolName, askKinds);
      if (askKind) {
        if (part.invalid) {
          logger.debug("Model sent an invalid ask; it receives the errors as a tool error", {
            toolCallId,
            toolName,
          });
        } else {
          askCalls.push({...parseAsk({input: part.input, kind: askKind}), toolCallId});
        }
        continue;
      }
      sink.emit({toolCall: {args: part.input, toolCallId, toolName}});
      record.rows.push({
        args: part.input as Record<string, unknown>,
        text: `Tool call: ${toolName}`,
        toolCallId,
        toolName,
        type: "tool-call",
      });
    } else if (part.type === "tool-result") {
      const toolResult = part.output as Record<string, unknown> | undefined;

      // If the tool result contains file data, send it as a separate file SSE event
      if (toolResult?.fileData && typeof toolResult.fileData === "string") {
        sink.emit({
          file: {
            filename: (toolResult.filename as string | undefined) ?? "document",
            mimeType: (toolResult.mimeType as string | undefined) ?? "application/octet-stream",
            url: toolResult.fileData,
          },
        });
        logger.debug("Sent generated file from tool result", {
          filename: toolResult.filename,
          mimeType: toolResult.mimeType,
        });
      }

      // Strip fileData from result before sending/storing to avoid bloating the SSE and DB
      const {fileData: _fileData, ...cleanResult} = toolResult ?? {};
      const toolName = part.toolName as string;
      const toolCallId = part.toolCallId as string;
      sink.emit({toolResult: {result: cleanResult, toolCallId, toolName}});
      record.rows.push({
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
    const cleaned = cleanStepText(stepTextBuffer);
    if (cleaned) {
      record.fullResponse += cleaned;
      sink.emit({text: cleaned});
    }
  }

  logger.debug("Stream completed", {fullResponseLength: record.fullResponse.length, partCount});

  // Check for generated images (e.g. from gemini-2.5-flash-image)
  try {
    const files = await result.files;
    if (files && files.length > 0) {
      for (const file of files) {
        if (file.mediaType.startsWith("image/")) {
          const dataUrl = `data:${file.mediaType};base64,${file.base64}`;
          generatedImages.push({mimeType: file.mediaType, url: dataUrl});
          sink.emit({image: {mimeType: file.mediaType, url: dataUrl}});
        }
      }
      logger.debug("Sent generated images", {count: files.length});
    }
  } catch (fileErr) {
    logger.debug("No files in response", {
      error: fileErr instanceof Error ? fileErr.message : String(fileErr),
    });
  }
};

/** The assistant's reply row, or none when the turn produced no text or images. */
const assistantRows = ({
  fullResponse,
  generatedImages,
  modelId,
}: {
  fullResponse: string;
  generatedImages: GeneratedImage[];
  modelId: string | undefined;
}): GptHistoryPrompt[] => {
  if (!fullResponse && generatedImages.length === 0) {
    return [];
  }
  const contentParts: MessageContentPart[] = generatedImages.map((img) => ({
    mimeType: img.mimeType,
    type: "image" as const,
    url: img.url,
  }));
  return [
    {
      model: modelId,
      text: fullResponse || "(image)",
      type: "assistant",
      ...(contentParts.length > 0 ? {content: contentParts} : {}),
    },
  ];
};

const askCallRow = (call: AskCall, status: GptHistoryAskStatus): GptHistoryPrompt => ({
  args: call.input,
  ask: {kind: call.kind, status},
  text: `Tool call: ${askToolName(call.kind)}`,
  toolCallId: call.toolCallId,
  toolName: askToolName(call.kind),
  type: "tool-call",
});

const droppedAskResultRow = (call: AskCall): GptHistoryPrompt => ({
  result: {action: "cancel", reason: ASK_CANCEL_REASONS.oneAskAtATime},
  text: `Tool result: ${askToolName(call.kind)}`,
  toolCallId: call.toolCallId,
  toolName: askToolName(call.kind),
  type: "tool-result",
});

const answeredAskMetadata = (resolvedAsk: ResolvedAsk | undefined): Record<string, unknown> =>
  resolvedAsk
    ? {
        ask: {
          action: resolvedAsk.action,
          kind: resolvedAsk.kind,
          phase: "answered",
          toolCallId: resolvedAsk.toolCallId,
        },
      }
    : {};

/**
 * Runs one chat turn: a new prompt, or the user's answer to the pending ask (`askResponse`).
 * `surface: "compact"` offers only the asks a small screen can show and asks for short replies.
 * Request errors throw an APIError before `sink.open()`; after that, failures are sent as an
 * `{error}` event. `/gpt/prompt` drives it with a server-sent events sink and the headless
 * `turn` action with `runBufferedChatTurn`.
 */
export const runChatTurn = async ({
  body,
  options,
  req,
  sink,
}: {
  body: Record<string, unknown>;
  options: GptRouteOptions;
  req: express.Request;
  sink: ChatTurnSink;
}): Promise<void> => {
  const {toolChoice, maxSteps} = options;
  const {model: requestModel, projectId, systemPrompt} = body;
  const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;
  const askKinds = resolveAskKinds(options.asks);
  const askAnswer = parseTurnBody({askKinds, body});
  const surface = parseSurface(body.surface);

  // Resolve AI service (per-request key takes priority, then configured service)
  logger.debug("Resolving AI service", {
    hasConfiguredService: !!options.aiService,
    hasCreateModelFn: !!options.createModelFn,
    hasPerRequestKey: !!req.headers["x-ai-api-key"],
  });
  const aiService = resolveAiService(req, options, requestModel as string | undefined);
  if (!aiService) {
    logger.debug("No AI service available, sending demo response");
    sink.open();
    sink.emit({text: DEMO_RESPONSE});
    sink.emit({done: true});
    return;
  }

  const turn = await startTurn({aiService, askAnswer, body, userId});
  const {isNewHistory, logPrompt, messages, replayedMessages, resolvedAsk, titlePrompt} = turn;
  let {history} = turn;
  const effectiveSystemPrompt = await buildSystemPrompt({
    history,
    options,
    projectId,
    systemPrompt,
    userId,
  });

  // Some models (e.g. gemini-2.5-flash-image) don't support tool calling
  const modelId = aiService.modelId;
  const supportsTools = !modelId?.includes("image");
  const offeredAskKinds = supportsTools ? askKindsForSurface({kinds: askKinds, surface}) : [];
  const allTools = await collectTools({
    askKinds: offeredAskKinds,
    options,
    req,
    supportsTools,
    surface,
  });
  const system = withTurnSystemPrompt({
    askKinds: offeredAskKinds,
    surface,
    systemPrompt: effectiveSystemPrompt,
  });

  sink.open();

  const startTime = DateTime.now().toMillis();
  const record: TurnRecord = {
    askCalls: [],
    fullResponse: "",
    generatedImages: [],
    rows: [...turn.rows],
  };
  let isSaved = false;
  const saveRows = async (rows: GptHistoryPrompt[]): Promise<number> => {
    const saved = await appendTurnRows({history, isNewHistory, projectId, rows});
    history = saved.history;
    isSaved = true;
    return saved.firstRowIndex;
  };
  try {
    if (resolvedAsk) {
      sink.emit({askResolved: {action: resolvedAsk.action, toolCallId: resolvedAsk.toolCallId}});
    }
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
      system: system ?? undefined,
      temperature: aiService.defaultTemperature,
      toolChoice: allTools ? (toolChoice ?? "auto") : undefined,
      tools: allTools,
    });

    await consumeStream({askKinds: offeredAskKinds, record, result, sink});
    const {askCalls, fullResponse, generatedImages} = record;

    // The first valid ask in the step pauses the turn; any other ask in that step is cancelled.
    const [asked, ...droppedAsks] = askCalls;
    const ask = asked ? {...asked, simple: toSimpleCard(asked)} : undefined;
    const firstRowIndex = await saveRows([
      ...record.rows,
      ...assistantRows({fullResponse, generatedImages, modelId: aiService.modelId}),
      ...(ask
        ? [
            askCallRow(ask, "pending"),
            ...droppedAsks.map((call) => askCallRow(call, "cancelled")),
            ...droppedAsks.map(droppedAskResultRow),
          ]
        : []),
    ]);
    const isPaused = ask
      ? await claimPendingAsk({
          ask,
          history,
          // A prompt turn's history ends with its own user message, the first row it appended.
          promptIndex: turn.promptIndex ?? firstRowIndex + 1,
          responseMessages: toStoredMessages([
            ...replayedMessages,
            ...(await result.response).messages,
          ]),
        })
      : false;
    const pausedAsk = isPaused ? ask : undefined;
    if (ask && !pausedAsk) {
      logger.warn("Cancelled an ask because another turn's ask is already pending", {
        historyId: history._id.toString(),
        toolCallId: ask.toolCallId,
      });
    }
    if (pausedAsk) {
      sink.emit({ask: pausedAsk, historyId: history._id.toString()});
    }

    const metadata = {
      ...answeredAskMetadata(resolvedAsk),
      ...(pausedAsk
        ? {
            [resolvedAsk ? "nextAsk" : "ask"]: {
              kind: pausedAsk.kind,
              phase: "asked",
              toolCallId: pausedAsk.toolCallId,
            },
          }
        : {}),
    };
    try {
      await AIRequest.logRequest({
        aiModel: modelId ?? "unknown",
        prompt: logPrompt,
        requestType: "general",
        response: fullResponse,
        responseTime: DateTime.now().toMillis() - startTime,
        userId: userId ?? undefined,
        ...(Object.keys(metadata).length > 0 ? {metadata} : {}),
      });
    } catch (logErr) {
      logger.warn("Failed to log AIRequest", {
        error: logErr instanceof Error ? logErr.message : String(logErr),
      });
    }

    // Generate a title for new conversations using a cheap model call
    let title = history.title;
    if (!title && fullResponse) {
      const perRequestApiKey = req.headers["x-ai-api-key"] as string | undefined;
      const generatedTitle = await generateTitle(
        titlePrompt,
        fullResponse,
        aiService,
        options,
        perRequestApiKey
      );
      if (generatedTitle) {
        title = await saveTitle({history, title: generatedTitle});
      }
    }

    logger.debug("Sending done event", {
      fullResponseLength: fullResponse.length,
      historyId: history._id.toString(),
    });
    sink.emit({
      done: true,
      historyId: history._id.toString(),
      ...(title ? {title} : {}),
      ...(pausedAsk ? {pendingAsk: {toolCallId: pausedAsk.toolCallId}} : {}),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error in GPT stream", {error: errorMessage});

    const metadata = answeredAskMetadata(resolvedAsk);
    try {
      await AIRequest.logRequest({
        aiModel: modelId ?? "unknown",
        error: errorMessage,
        prompt: logPrompt,
        requestType: "general",
        responseTime: DateTime.now().toMillis() - startTime,
        userId: userId ?? undefined,
        ...(Object.keys(metadata).length > 0 ? {metadata} : {}),
      });
    } catch (logErr) {
      logger.warn("Failed to log AIRequest error", {
        error: logErr instanceof Error ? logErr.message : String(logErr),
      });
    }

    sink.emit({error: error instanceof Error ? error.message : "Unknown error"});

    // Keep what the user saw before the failure. Asks are dropped: the turn cannot pause on them.
    if (!isSaved) {
      try {
        await saveRows([
          ...record.rows,
          ...assistantRows({
            fullResponse: record.fullResponse,
            generatedImages: record.generatedImages,
            modelId: aiService.modelId,
          }),
        ]);
      } catch (saveErr) {
        logger.error("Failed to save a failed turn's rows", {
          error: saveErr instanceof Error ? saveErr.message : String(saveErr),
          historyId: history._id.toString(),
        });
      }
    }
    sink.emit({
      done: true,
      ...(isSaved || !isNewHistory ? {historyId: history._id.toString()} : {}),
      ...(history.title ? {title: history.title} : {}),
    });
  }
};

interface BufferedTurn {
  ask?: ChatTurnAskEvent["ask"];
  done?: ChatTurnDoneEvent;
  errors: string[];
  texts: string[];
}

/**
 * Runs a turn to completion and returns it as one JSON result, for clients that do not read
 * server-sent events. Nothing is written to the response while the turn runs, so a client that
 * disconnects does not stop it: the turn still finishes and saves.
 */
export const runBufferedChatTurn = async ({
  body,
  options,
  req,
}: {
  body: Record<string, unknown> & {historyId: string};
  options: GptRouteOptions;
  req: express.Request;
}): Promise<TurnResult> => {
  const turn: BufferedTurn = {errors: [], texts: []};
  await runChatTurn({
    body,
    options,
    req,
    sink: {
      emit: (event) => {
        if ("text" in event) {
          turn.texts.push(event.text);
        } else if ("error" in event) {
          turn.errors.push(event.error);
        } else if ("ask" in event) {
          turn.ask = event.ask;
        } else if ("done" in event) {
          turn.done = event;
        }
      },
      open: () => {},
    },
  });
  const {ask, done, errors, texts} = turn;
  return {
    ...(errors.length > 0 ? {error: errors.join("\n")} : {}),
    historyId: done?.historyId ?? body.historyId,
    ...(ask ? {pendingAsk: {kind: ask.kind, simple: ask.simple, toolCallId: ask.toolCallId}} : {}),
    text: texts.join(""),
    ...(done?.title ? {title: done.title} : {}),
  };
};
