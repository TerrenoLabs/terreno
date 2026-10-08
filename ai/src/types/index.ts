import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "@terreno/api";
import type {Ask, AskKind, ConfirmAskInput, DatasetColumn, SimpleCard} from "@terreno/blocks";
import type {LanguageModel, ModelMessage, StopCondition, ToolSet} from "ai";
import type mongoose from "mongoose";

// ============================================================
// AIRequest Types
// ============================================================

export const DEFAULT_AI_REQUEST_TYPES = [
  "general",
  "json_array",
  "json_object",
  "json_value",
  "remix",
  "summarization",
  "translation",
  "ui_action",
  "ui_blocks",
] as const;
export type DefaultAIRequestType = (typeof DEFAULT_AI_REQUEST_TYPES)[number];
export type AIRequestType = DefaultAIRequestType | (string & {});

export interface AIRequestDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
  aiModel: string;
  parentRequestId?: mongoose.Types.ObjectId;
  prompt: string;
  requestType: AIRequestType;
  response?: string;
  responseTime?: number;
  subRequestIds?: mongoose.Types.ObjectId[];
  tokensUsed?: number;
  totalResponseTime?: number;
  totalTokensUsed?: number;
  updated: Date;
  userId?: mongoose.Types.ObjectId;
}

export interface AIRequestStatics
  extends FindExactlyOnePlugin<AIRequestDocument>,
    FindOneOrNonePlugin<AIRequestDocument> {
  logMultiAgentRequest(params: LogMultiAgentRequestParams): Promise<AIRequestDocument>;
  logRequest(params: LogRequestParams): Promise<AIRequestDocument>;
}

export interface AIRequestModel extends mongoose.Model<AIRequestDocument>, AIRequestStatics {}

export interface LogRequestParams {
  error?: string;
  metadata?: Record<string, unknown>;
  aiModel: string;
  prompt: string;
  requestType: AIRequestType;
  response?: string;
  responseTime?: number;
  tokensUsed?: number;
  userId?: mongoose.Types.ObjectId;
}

export interface LogMultiAgentRequestParams {
  aiModel: string;
  metadata?: Record<string, unknown>;
  requestType: AIRequestType;
  subRequestIds: mongoose.Types.ObjectId[];
  totalResponseTime: number;
  totalTokensUsed: number;
  userId?: mongoose.Types.ObjectId;
}

// ============================================================
// Content Part Types (Multi-modal)
// ============================================================

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image";
  url: string;
  mimeType?: string;
  /** Durable storage key when the attachment was uploaded through FileStorageService. */
  gcsKey?: string;
}

export interface FileContentPart {
  type: "file";
  url: string;
  filename?: string;
  mimeType: string;
  /** Durable storage key when the attachment was uploaded through FileStorageService. */
  gcsKey?: string;
}

export type MessageContentPart = TextContentPart | ImageContentPart | FileContentPart;

// ============================================================
// GptHistory Types
// ============================================================

export type GptHistoryAskStatus = "pending" | "answered" | "cancelled";

/** Set on asks the server makes itself: `approval` asks before a host tool with `needsApproval` runs. */
export type AskOrigin = "approval";

/** Marks a `tool-call` row as an ask and records whether the user has answered it. */
export interface GptHistoryPromptAsk {
  kind: AskKind;
  /** `approval` when the server asked before a host tool runs; the row is then display-only. */
  origin?: AskOrigin;
  status: GptHistoryAskStatus;
}

/** Lifecycle of an assistant reply that is persisted while it streams. */
export type GptHistoryPromptStatus = "streaming" | "complete" | "error";

export interface GptHistoryPrompt {
  model?: string;
  rating?: "up" | "down";
  /** Set on assistant replies produced by /gpt/prompt. "streaming" while partial text is persisted. */
  status?: GptHistoryPromptStatus;
  /** Identifies one /gpt/prompt reply so resume clients can follow it. */
  streamId?: string;
  text: string;
  type: "user" | "assistant" | "system" | "tool-call" | "tool-result";
  content?: MessageContentPart[];
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  ask?: GptHistoryPromptAsk;
}

interface GptHistoryPendingAskState {
  /** The AI SDK approval request an `approval` ask answers. It is also the ask's `toolCallId`. */
  approvalId?: string;
  created: Date;
  origin?: AskOrigin;
  /** Number of leading `prompts` rows that form the paused turn's history. */
  promptIndex: number;
  /** AI SDK messages the paused turn produced, replayed verbatim when the user answers. */
  responseMessages: ModelMessage[];
  simple: SimpleCard;
  toolCallId: string;
  /** The host tool an `approval` ask asks to run. */
  toolName?: string;
}

/** The ask a history is waiting on. At most one per history. */
export type GptHistoryPendingAsk = Ask & GptHistoryPendingAskState;

export interface GptHistoryDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  pendingAsk?: GptHistoryPendingAsk;
  projectId?: mongoose.Types.ObjectId;
  prompts: GptHistoryPrompt[];
  title?: string;
  updated: Date;
  userId: mongoose.Types.ObjectId;
}

export interface GptHistoryStatics
  extends FindExactlyOnePlugin<GptHistoryDocument>,
    FindOneOrNonePlugin<GptHistoryDocument> {}

export interface GptHistoryModel extends mongoose.Model<GptHistoryDocument>, GptHistoryStatics {}

// ============================================================
// Project Types
// ============================================================

export interface ProjectMemory {
  _id?: mongoose.Types.ObjectId;
  category?: string;
  created?: Date;
  source: "user" | "auto";
  text: string;
}

export interface ProjectDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  memories: ProjectMemory[];
  name: string;
  systemContext: string;
  updated: Date;
  userId: mongoose.Types.ObjectId;
}

export interface ProjectStatics
  extends FindExactlyOnePlugin<ProjectDocument>,
    FindOneOrNonePlugin<ProjectDocument> {}

export interface ProjectModel extends mongoose.Model<ProjectDocument>, ProjectStatics {}

// ============================================================
// AI Service Types
// ============================================================

export interface AIServiceOptions {
  defaultTemperature?: number;
  model: LanguageModel;
}

export interface GenerateObservabilityOptions {
  priceMap?: Record<string, {inputPerMTok: number; outputPerMTok: number}>;
  promptLabel?: string;
  promptName?: string;
  sensitive?: boolean;
  sessionId?: string;
  skipTrace?: boolean;
}

export interface GenerateTextOptions extends GenerateObservabilityOptions {
  maxOutputTokens?: number;
  prompt: string;
  stopWhen?: StopCondition<ToolSet>;
  systemPrompt?: string;
  temperature?: number;
  toolChoice?: "auto" | "none" | "required";
  tools?: Record<string, import("ai").Tool>;
  userId?: mongoose.Types.ObjectId;
}

export interface GenerateStreamOptions extends GenerateObservabilityOptions {
  maxOutputTokens?: number;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  userId?: mongoose.Types.ObjectId;
}

export interface GenerateChatStreamOptions extends GenerateObservabilityOptions {
  messages: Array<{content: string; role: "user" | "assistant" | "system"}>;
  stopWhen?: StopCondition<ToolSet>;
  systemPrompt?: string;
  toolChoice?: "auto" | "none" | "required";
  tools?: Record<string, import("ai").Tool>;
  userId?: mongoose.Types.ObjectId;
}

export interface RemixOptions extends GenerateObservabilityOptions {
  text: string;
  userId?: mongoose.Types.ObjectId;
}

export interface SummaryOptions extends GenerateObservabilityOptions {
  text: string;
  userId?: mongoose.Types.ObjectId;
}

export interface TranslateOptions extends GenerateObservabilityOptions {
  sourceLanguage?: string;
  targetLanguage: string;
  text: string;
  userId?: mongoose.Types.ObjectId;
}

export interface GenerateJsonValueOptions extends GenerateObservabilityOptions {
  maxOutputTokens?: number;
  /** Optional name passed to the provider for structured-output guidance. */
  outputName?: string;
  /** Optional description passed to the provider for structured-output guidance. */
  outputDescription?: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  userId?: mongoose.Types.ObjectId;
}

export interface GenerateJsonObjectOptions<OBJECT> extends GenerateObservabilityOptions {
  maxOutputTokens?: number;
  prompt: string;
  /** Zod schema, `jsonSchema(...)`, or other `FlexibleSchema` accepted by the AI SDK. */
  schema: import("ai").FlexibleSchema<OBJECT>;
  schemaDescription?: string;
  schemaName?: string;
  systemPrompt?: string;
  temperature?: number;
  userId?: mongoose.Types.ObjectId;
}

export interface ObsTestMultiStageCall1Output {
  phrase: string;
}

export interface ObsTestMultiStageCall2Output {
  keywords: string[];
}

export interface ObsTestMultiStageMetrics {
  call1: {charCount: number; wordCount: number};
  call2: {charCount: number; wordCount: number};
  combinedCharCount: number;
}

export interface ObsTestMultiStageFinalOutput {
  keywords: string[];
  metrics: ObsTestMultiStageMetrics;
  phrase: string;
  sentence: string;
}

export interface GenerateJsonArrayOptions<ELEMENT> extends GenerateObservabilityOptions {
  /** Schema for each array element. */
  element: import("ai").FlexibleSchema<ELEMENT>;
  /** Optional description for the array output (provider guidance). */
  outputDescription?: string;
  /** Optional name for the array output (provider guidance). */
  outputName?: string;
  maxOutputTokens?: number;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  userId?: mongoose.Types.ObjectId;
}

// ============================================================
// Route Option Types
// ============================================================

/** Makes the `confirm` input of the approval ask for one call of a host tool, from the call's input. */
export type ApprovalAskInput = (input: unknown) => ConfirmAskInput;

export interface AsksOptions {
  /**
   * The approval ask for host tools with `needsApproval`, by tool name. Without an entry, or when
   * it throws or returns an input that is not a valid `confirm` input, the ask is "Allow
   * <toolName>?" with the tool's description and Allow / Deny buttons.
   */
  approvals?: Record<string, ApprovalAskInput>;
  /** Ask kinds offered to the model, each as the tool `ask_<kind>`. Defaults to every kind. */
  kinds?: AskKind[];
  /**
   * The per-file cap for answers to a `files` ask, in bytes. Defaults to 10 MB, the
   * `/files/upload` default; `AiApp` applies it to `/files/upload` too.
   */
  maxFileSizeBytes?: number;
}

/** Loads an upload's bytes by its GCS key. `FileStorageService` implements it. */
export interface AskFileDownloader {
  download: (gcsKey: string) => Promise<Buffer>;
}

/** What a host callback may return. `blocks` is a whole-reply document. */
export interface HostActionResult {
  blocks?: unknown;
  replace?: "block" | "message";
  text?: string;
}

/** A Zod schema's `safeParse`, so hosts can pass `z.object(...)` without this package depending on a Zod version. */
export interface HostPayloadSchema {
  safeParse: (
    value: unknown
  ) =>
    | {data: unknown; success: true}
    | {error: {issues: {message: string; path: PropertyKey[]}[]}; success: false};
}

export interface HostActionContext {
  blockId: string;
  elementId: string;
  history: GptHistoryDocument;
  messageId: string;
  payload: unknown;
  user: {_id?: mongoose.Types.ObjectId};
}

/** One host callback that `POST /gpt/actions` runs for a block button. */
export interface HostAction {
  handler?: (
    context: HostActionContext
  ) => Promise<HostActionResult | undefined> | HostActionResult | undefined;
  /** The interactive block this action serves. `scaleStepperHostAction` sets `stepper`. */
  handles?: "stepper" | "checklist";
  /**
   * When `false`, the `ui_action` `AIRequest` row keeps the ids-only prompt plus a numeric
   * `payload.value`, and leaves out the returned document. Default `true` logs the response.
   */
  logResponse?: boolean;
  payload?: HostPayloadSchema;
}

/** `addGptRoutes` `uiBlocks`. `true` checks every assistant reply. `hostActions` names the callbacks the model may emit. */
export interface UiBlocksOptions {
  /** Milliseconds before a host callback returns 504. Default 10 seconds. */
  actionTimeoutMs?: number;
  /** Rows stored by `registerAiDataset`. Default 50,000. A larger write returns 413. */
  datasetMaxRows?: number;
  /** Days before a stored dataset expires. `0` (the default) keeps it. */
  datasetTtlDays?: number;
  /** When true, `html` blocks are allowed and sanitized before they are stored. */
  html?: boolean;
  /** Hostnames allowed on `https` image sources. Empty rejects every https image. */
  imageHosts?: readonly string[];
  hostActions?: Record<string, HostAction>;
  repair?: boolean;
}

export interface GptRouteOptions {
  /** Pre-configured AIService. Optional when using per-request keys or demo mode. */
  aiService?: import("../service/aiService").AIService;
  /**
   * Let the model ask the user typed questions with client-side ask tools. `true` offers every
   * ask kind. Off by default; when off, tools, system prompt, SSE events, and the `/gpt/histories`
   * routes are unchanged.
   */
  asks?: boolean | AsksOptions;
  /** Factory to create a LanguageModel from a per-request API key (x-ai-api-key header). */
  createModelFn?: (apiKey: string, modelId?: string) => import("ai").LanguageModel;
  /** Factory to create a LanguageModel on the server side without a per-request key (e.g. Vertex AI with ADC). Used for model switching when no x-ai-api-key header is present. Returns undefined if no provider is configured (falls through to demo mode). */
  createServerModelFn?: (modelId?: string) => import("ai").LanguageModel | undefined;
  /** Factory to create per-request tools (e.g. tools that need the request's API key). Merged with static tools. */
  createRequestTools?: (req: import("express").Request) => Record<string, import("ai").Tool>;
  /** Not read: the routes send a canned demo reply whenever no AI service resolves. */
  demoMode?: boolean;
  /**
   * Where uploads are stored. `download` loads a `files` ask by `fileId`. `upload` and
   * `getSignedUrl` store `data:` attachments and sign them on later turns. A service with only
   * `download` still answers `files` asks; attachments are then saved as sent.
   */
  fileStorageService?: import("../service/fileStorage").FileStorageService | AskFileDownloader;
  mcpService?: import("../service/mcpService").MCPService;
  openApiOptions?: Record<string, unknown>;
  tools?: Record<string, import("ai").Tool>;
  toolChoice?: "auto" | "none" | "required";
  maxSteps?: number;
  /** Cheap model ID used for generating conversation titles (e.g. "gemini-3.5-flash-lite"). Falls back to the main model if not set. */
  titleModelId?: string;
  /**
   * Assistant replies are whole-reply block documents. Off by default; when off, the system
   * prompt, SSE events, `/gpt/datasets`, and `/gpt/actions` are unchanged. `true` validates the
   * final text, emits `{blocks}` before `{done}`, and mounts `GET /gpt/datasets/:id` and
   * `POST /gpt/actions`. `{repair: true}` runs one repair call when that check fails.
   */
  uiBlocks?: boolean | UiBlocksOptions;
  /** Langfuse prompt name to load and use as the system prompt. Compiled with no variables.
   * Falls back gracefully if Langfuse is not configured or the prompt is not found. */
  langfuseSystemPromptName?: string;
  /**
   * When `false` or the function returns `false`, prompts that include attachments are rejected.
   * Omit or pass `true` to leave uploads enabled.
   */
  fileUploadsEnabled?: import("../service/fileUploadsGate").FileUploadsEnabled;
  /** How often partial assistant output is persisted while streaming. Defaults to 1000ms. */
  streamPersistIntervalMs?: number;
  /** How often the resume endpoint polls for new partial output. Defaults to 500ms. */
  streamResumePollIntervalMs?: number;
  /** A streaming reply with no persisted update for this long is treated as interrupted. Defaults to 60000ms. */
  streamStaleAfterMs?: number;
}

export interface GptHistoryRouteOptions {
  /**
   * The chat options headless turns run with, usually the ones passed to `addGptRoutes`. When they
   * turn `asks` on, `/gpt/histories` adds `GET pendingAsks` and `POST /:id/turn` for clients that do
   * not read server-sent events, such as a watch app. With `asks` off it adds neither, so a host
   * that never turned asks on gets no new endpoints.
   */
  chat?: GptRouteOptions;
  openApiOptions?: Record<string, unknown>;
}

export interface AiRequestsExplorerRouteOptions {
  openApiOptions?: Record<string, unknown>;
}

export interface FileRouteOptions {
  gcsBucket: string;
  maxFileSize?: number;
  openApiOptions?: Record<string, unknown>;
  /**
   * When `false` or the function returns `false`, `POST /files/upload` is rejected.
   * Reads and deletes stay available. Omit or pass `true` to leave uploads enabled.
   */
  fileUploadsEnabled?: import("../service/fileUploadsGate").FileUploadsEnabled;
}

export interface McpRouteOptions {
  mcpService: import("../service/mcpService").MCPService;
  openApiOptions?: Record<string, unknown>;
}

// ============================================================
// File Attachment Types
// ============================================================

// ============================================================
// AIDataset Types
// ============================================================

export type AIDatasetColumn = DatasetColumn;

export type AIDatasetCell = string | number | null;

/** No instance methods. `ownerId` is a virtual of `userId`. */
export type AIDatasetMethods = Record<string, never>;

export interface AIDatasetDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  columns: AIDatasetColumn[];
  created: Date;
  deleted: boolean;
  expiresAt?: Date;
  historyId: mongoose.Types.ObjectId;
  rowCount: number;
  rows: AIDatasetCell[][];
  updated: Date;
  userId: mongoose.Types.ObjectId;
}

export interface AIDatasetStatics
  extends FindExactlyOnePlugin<AIDatasetDocument>,
    FindOneOrNonePlugin<AIDatasetDocument> {}

export interface AIDatasetModel
  extends mongoose.Model<AIDatasetDocument, object, AIDatasetMethods>,
    AIDatasetStatics {}

export type AIDatasetSchema = mongoose.Schema<AIDatasetDocument, AIDatasetModel, AIDatasetMethods>;

export interface FileAttachmentDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  filename: string;
  gcsKey: string;
  mimeType: string;
  size: number;
  updated: Date;
  url: string;
  userId: mongoose.Types.ObjectId;
}

export interface FileAttachmentStatics
  extends FindExactlyOnePlugin<FileAttachmentDocument>,
    FindOneOrNonePlugin<FileAttachmentDocument> {}

export interface FileAttachmentModel
  extends mongoose.Model<FileAttachmentDocument>,
    FileAttachmentStatics {}

// ============================================================
// MCP Types
// ============================================================

export interface MCPServerConfig {
  name: string;
  transport: {type: "sse"; url: string; headers?: Record<string, string>};
}
