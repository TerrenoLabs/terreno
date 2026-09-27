import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "@terreno/api";
import type {Ask, AskKind, SimpleCard} from "@terreno/blocks";
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
}

export interface FileContentPart {
  type: "file";
  url: string;
  filename?: string;
  mimeType: string;
}

export type MessageContentPart = TextContentPart | ImageContentPart | FileContentPart;

// ============================================================
// GptHistory Types
// ============================================================

export type GptHistoryAskStatus = "pending" | "answered" | "cancelled";

/** Marks a `tool-call` row as an ask and records whether the user has answered it. */
export interface GptHistoryPromptAsk {
  kind: AskKind;
  status: GptHistoryAskStatus;
}

export interface GptHistoryPrompt {
  model?: string;
  rating?: "up" | "down";
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
  created: Date;
  /** Number of leading `prompts` rows that form the paused turn's history. */
  promptIndex: number;
  /** AI SDK messages the paused turn produced, replayed verbatim when the user answers. */
  responseMessages: ModelMessage[];
  simple: SimpleCard;
  toolCallId: string;
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

export interface GenerateTextOptions {
  maxOutputTokens?: number;
  prompt: string;
  stopWhen?: StopCondition<ToolSet>;
  systemPrompt?: string;
  temperature?: number;
  toolChoice?: "auto" | "none" | "required";
  tools?: Record<string, import("ai").Tool>;
  userId?: mongoose.Types.ObjectId;
}

export interface GenerateStreamOptions {
  maxOutputTokens?: number;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  userId?: mongoose.Types.ObjectId;
}

export interface GenerateChatStreamOptions {
  messages: Array<{content: string; role: "user" | "assistant" | "system"}>;
  stopWhen?: StopCondition<ToolSet>;
  systemPrompt?: string;
  toolChoice?: "auto" | "none" | "required";
  tools?: Record<string, import("ai").Tool>;
  userId?: mongoose.Types.ObjectId;
}

export interface RemixOptions {
  text: string;
  userId?: mongoose.Types.ObjectId;
}

export interface SummaryOptions {
  text: string;
  userId?: mongoose.Types.ObjectId;
}

export interface TranslateOptions {
  sourceLanguage?: string;
  targetLanguage: string;
  text: string;
  userId?: mongoose.Types.ObjectId;
}

export interface GenerateJsonValueOptions {
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

export interface GenerateJsonObjectOptions<OBJECT> {
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

export interface GenerateJsonArrayOptions<ELEMENT> {
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

export interface AsksOptions {
  /** Ask kinds offered to the model, each as the tool `ask_<kind>`. Defaults to every kind. */
  kinds?: AskKind[];
}

export interface GptRouteOptions {
  /** Pre-configured AIService. Optional when using per-request keys or demo mode. */
  aiService?: import("../service/aiService").AIService;
  /**
   * Let the model ask the user typed questions with client-side ask tools. `true` offers every
   * ask kind. Off by default; when off, tools, system prompt, and SSE events are unchanged.
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
  mcpService?: import("../service/mcpService").MCPService;
  openApiOptions?: Record<string, unknown>;
  tools?: Record<string, import("ai").Tool>;
  toolChoice?: "auto" | "none" | "required";
  maxSteps?: number;
  /** Cheap model ID used for generating conversation titles (e.g. "gemini-2.0-flash-lite"). Falls back to the main model if not set. */
  titleModelId?: string;
  /** Langfuse prompt name to load and use as the system prompt. Compiled with no variables.
   * Falls back gracefully if Langfuse is not configured or the prompt is not found. */
  langfuseSystemPromptName?: string;
}

export interface GptHistoryRouteOptions {
  openApiOptions?: Record<string, unknown>;
}

export interface AiRequestsExplorerRouteOptions {
  openApiOptions?: Record<string, unknown>;
}

export interface FileRouteOptions {
  gcsBucket: string;
  maxFileSize?: number;
  openApiOptions?: Record<string, unknown>;
}

export interface McpRouteOptions {
  mcpService: import("../service/mcpService").MCPService;
  openApiOptions?: Record<string, unknown>;
}

// ============================================================
// File Attachment Types
// ============================================================

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
