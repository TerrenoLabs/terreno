import type {TerrenoPlugin} from "@terreno/api";
import type {LanguageModel, Tool} from "ai";
import type express from "express";

import {addAiRequestsExplorerRoutes} from "./routes/aiRequestsExplorer";
import {addFileRoutes} from "./routes/files";
import {addGptRoutes} from "./routes/gpt";
import {addGptHistoryRoutes} from "./routes/gptHistories";
import {addMcpRoutes} from "./routes/mcp";
import {addProjectRoutes} from "./routes/projects";
import type {AIService} from "./service/aiService";
import type {FileStorageService} from "./service/fileStorage";
import type {MCPService} from "./service/mcpService";
import type {AsksOptions} from "./types";

export interface AiAppOptions {
  /** Pre-configured AIService instance. Optional when using per-request keys or demo mode. */
  aiService?: AIService;
  /** Let the model ask the user typed questions in chat. Passed through to `addGptRoutes`. */
  asks?: boolean | AsksOptions;
  /** Factory function to create a LanguageModel from a per-request API key (sent via x-ai-api-key header). */
  createModelFn?: (apiKey: string, modelId?: string) => LanguageModel;
  /** Factory function to create a LanguageModel on the server side without a per-request key (e.g. Vertex AI with ADC). Returns undefined if no provider is configured. */
  createServerModelFn?: (modelId?: string) => LanguageModel | undefined;
  /** When true and no AI service is available, routes return canned demo responses instead of failing. */
  demoMode?: boolean;
  /** File storage service for handling file uploads to GCS. */
  fileStorageService?: FileStorageService;
  /** GCS bucket name for file uploads. Required alongside fileStorageService. */
  gcsBucket?: string;
  /** Maximum number of tool-calling steps per chat request. Defaults to 5 when tools are present. */
  maxSteps?: number;
  /** MCP service for connecting to external tool servers. */
  mcpService?: MCPService;
  /** OpenAPI options passed through to route builders for spec generation. */
  openApiOptions?: Record<string, unknown>;
  /** Tool choice strategy for chat requests. Defaults to "auto" when tools are present. */
  toolChoice?: "auto" | "none" | "required";
  /** Cheap model ID used for generating conversation titles (e.g. "gemini-2.0-flash-lite"). Falls back to the main model if not set. */
  titleModelId?: string;
  /** Tool definitions available to the AI model during chat. */
  tools?: Record<string, Tool>;
}

/**
 * TerrenoPlugin that mounts all AI routes (GPT chat, history, file uploads, MCP, admin explorer).
 *
 * Supports three modes of operation:
 * - **Configured**: Pass an `aiService` for server-wide AI access
 * - **Per-request keys**: Pass a `createModelFn` so clients can supply their own API key via `x-ai-api-key` header
 * - **Demo mode**: When neither service nor per-request key is available, returns a canned response
 *
 * @example
 * ```typescript
 * import {AiApp, AIService} from "@terreno/ai";
 * import {google} from "@ai-sdk/google";
 *
 * const aiService = new AIService({model: google("gemini-2.5-flash")});
 * new AiApp({aiService, tools: myTools}).register(app);
 * ```
 *
 * @example
 * ```typescript
 * // Demo mode with per-request key support (no server-side API key needed)
 * new AiApp({
 *   createModelFn: (key) => google("gemini-2.5-flash", {apiKey: key}),
 *   demoMode: true,
 * }).register(app);
 * ```
 */
export class AiApp implements TerrenoPlugin {
  private options: AiAppOptions;

  constructor(options: AiAppOptions) {
    this.options = options;
  }

  register(app: express.Application): void {
    const router = app;
    const {
      aiService,
      asks,
      createModelFn,
      createServerModelFn,
      demoMode,
      fileStorageService,
      gcsBucket,
      maxSteps,
      mcpService,
      openApiOptions,
      titleModelId,
      toolChoice,
      tools,
    } = this.options;

    addGptHistoryRoutes(router, {openApiOptions});
    addGptRoutes(router, {
      aiService,
      asks,
      createModelFn,
      createServerModelFn,
      demoMode,
      maxSteps,
      mcpService,
      openApiOptions,
      titleModelId,
      toolChoice,
      tools,
    });
    addAiRequestsExplorerRoutes(router, {openApiOptions});
    addProjectRoutes(router, {openApiOptions});

    if (fileStorageService && gcsBucket) {
      addFileRoutes(router, {
        fileStorageService,
        gcsBucket,
        openApiOptions,
      });
    }

    if (mcpService) {
      addMcpRoutes(router, {mcpService, openApiOptions});
    }
  }
}
