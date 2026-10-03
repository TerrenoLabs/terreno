import {randomUUID} from "node:crypto";
import {APIError, logger} from "@terreno/api";
import type {DataContent, JSONValue, LanguageModel, ModelMessage} from "ai";
import {
  generateText as aiGenerateText,
  NoObjectGeneratedError,
  Output,
  stepCountIs,
  streamText,
} from "ai";
import {DateTime} from "luxon";
import type mongoose from "mongoose";

import {AIRequest} from "../models/aiRequest";
import {getObservabilityApp} from "../observability/observabilityAppRegistry";
import type {ModelPrice, PromptVersionRef, SpanRecord, TraceRecord} from "../observability/types";
import type {
  AIRequestType,
  AIServiceOptions,
  GenerateChatStreamOptions,
  GenerateJsonArrayOptions,
  GenerateJsonObjectOptions,
  GenerateJsonValueOptions,
  GenerateObservabilityOptions,
  GenerateStreamOptions,
  GenerateTextOptions,
  GptHistoryPrompt,
  RemixOptions,
  SummaryOptions,
  TranslateOptions,
} from "../types";
import {normalizeLlmJsonTextForStructuredOutput} from "./parseAiJson";
import {
  CONTENT_SUMMARY_PROMPT,
  DEFAULT_GPT_MEMORY,
  JSON_VALUE_SYSTEM_PROMPT,
  REMIX_PROMPT,
  TRANSLATION_PROMPT,
} from "./prompts";

export const TemperaturePresets = {
  BALANCED: 0.7,
  DEFAULT: 1.0,
  DETERMINISTIC: 0,
  HIGH: 1.5,
  LOW: 0.3,
  MAXIMUM: 2.0,
} as const;

/**
 * Wraps a language model so non-streaming `doGenerate` text parts are normalized via
 * {@link normalizeLlmJsonTextForStructuredOutput} (fences, preamble, balanced slice, light repairs)
 * before Vercel `Output.*` parsing.
 */
const withStrippedJsonFencesModel = (model: LanguageModel): LanguageModel => {
  if (typeof model === "string") {
    return model;
  }

  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === "doGenerate") {
        const original = Reflect.get(target, prop, receiver);
        if (typeof original !== "function") {
          return original;
        }

        const boundGenerate = original as (options: unknown) => PromiseLike<{
          content: Array<{text?: string; type: string; [key: string]: unknown}>;
          [key: string]: unknown;
        }>;

        return async (options: unknown) => {
          const result = await Promise.resolve(boundGenerate.call(target, options));
          if (!result?.content || !Array.isArray(result.content)) {
            return result;
          }

          return {
            ...result,
            content: result.content.map((part) => {
              if (part.type !== "text" || typeof part.text !== "string") {
                return part;
              }

              return {
                ...part,
                text: normalizeLlmJsonTextForStructuredOutput(part.text),
              };
            }),
          };
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as LanguageModel;
};

const getModelId = (model: LanguageModel): string => {
  if (typeof model === "string") {
    return model;
  }
  return (model as {modelId?: string}).modelId ?? "unknown";
};

const toIsoUtc = (millis: number): string => {
  return DateTime.fromMillis(millis, {zone: "utc"}).toISO() ?? "";
};

const readTokenUsage = (
  usage:
    | {
        completionTokens?: number;
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        totalTokens?: number;
      }
    | undefined
): {inputTokens?: number; outputTokens?: number; totalTokens?: number} => {
  return {
    inputTokens: usage?.inputTokens ?? usage?.promptTokens,
    outputTokens: usage?.outputTokens ?? usage?.completionTokens,
    totalTokens: usage?.totalTokens,
  };
};

const computeCostUsd = (params: {
  inputTokens?: number;
  modelId: string;
  outputTokens?: number;
  priceMap?: Record<string, ModelPrice>;
}): number | undefined => {
  if (!params.priceMap) {
    return undefined;
  }
  const price = params.priceMap[params.modelId];
  if (!price || params.inputTokens === undefined || params.outputTokens === undefined) {
    return undefined;
  }
  return (
    (price.inputPerMTok * params.inputTokens + price.outputPerMTok * params.outputTokens) /
    1_000_000
  );
};

interface ResolvedObservability {
  priceMap?: Record<string, ModelPrice>;
  promptRef?: PromptVersionRef;
  sensitive: boolean;
  sessionId?: string;
  skipTrace: boolean;
  systemPrompt?: string;
}

export class AIService {
  readonly model: LanguageModel;
  readonly defaultTemperature: number;
  private structuredJsonModel?: LanguageModel;

  constructor({model, defaultTemperature = TemperaturePresets.DEFAULT}: AIServiceOptions) {
    this.model = model;
    this.defaultTemperature = defaultTemperature;
  }

  get modelId(): string {
    return getModelId(this.model);
  }

  private getModelForStructuredJson(): LanguageModel {
    if (!this.structuredJsonModel) {
      this.structuredJsonModel = withStrippedJsonFencesModel(this.model);
    }
    return this.structuredJsonModel;
  }

  private describeStructuredGenerationError(error: unknown): string {
    if (error instanceof Error) {
      const base = `${error.name}: ${error.message}`;
      if (error.cause instanceof Error) {
        return `${base} | cause: ${error.cause.name}: ${error.cause.message}`;
      }
      return base;
    }
    return String(error);
  }

  private extractRawModelTextFromStructuredError(error: unknown): string | undefined {
    if (NoObjectGeneratedError.isInstance(error) && typeof error.text === "string") {
      return error.text;
    }
    if (error instanceof Error && "text" in error) {
      const t = (error as {text?: unknown}).text;
      if (typeof t === "string") {
        return t;
      }
    }
    return undefined;
  }

  private extractFinishReasonFromStructuredError(error: unknown): string | undefined {
    if (NoObjectGeneratedError.isInstance(error) && error.finishReason) {
      return error.finishReason;
    }
    return undefined;
  }

  private async logStructuredJsonFailure(params: {
    error: unknown;
    observability: ResolvedObservability;
    prompt: string;
    requestType: AIRequestType;
    responseTime: number;
    startTime: number;
    system: string;
    userId?: mongoose.Types.ObjectId;
  }): Promise<void> {
    const rawText = this.extractRawModelTextFromStructuredError(params.error);
    const responseForLog =
      rawText !== undefined && rawText.length > 0
        ? rawText
        : "(no raw model text captured on this error)";
    const errorDescription = this.describeStructuredGenerationError(params.error);
    const finishReason = this.extractFinishReasonFromStructuredError(params.error);
    const errorStack =
      params.error instanceof Error && typeof params.error.stack === "string"
        ? params.error.stack.length > 8000
          ? `${params.error.stack.slice(0, 8000)}…`
          : params.error.stack
        : undefined;

    logger.error("AIService structured JSON generation failed", {
      aiModel: getModelId(this.model),
      error: errorDescription,
      finishReason,
      prompt: params.prompt,
      requestType: params.requestType,
      response: rawText ?? "",
      system: params.system,
    });

    await this.logRequestAndTrace({
      error: errorDescription,
      metadata: {
        errorStack,
        finishReason,
        rawModelTextCaptured: Boolean(rawText && rawText.length > 0),
        system: params.system,
      },
      observability: params.observability,
      prompt: params.prompt,
      requestType: params.requestType,
      response: responseForLog,
      responseTime: params.responseTime,
      startTime: params.startTime,
      userId: params.userId,
    });
  }

  private async logRequest(params: {
    aiModel: string;
    error?: string;
    metadata?: Record<string, unknown>;
    prompt: string;
    requestType: AIRequestType;
    response?: string;
    responseTime?: number;
    tokensUsed?: number;
    userId?: mongoose.Types.ObjectId;
  }): Promise<void> {
    try {
      await AIRequest.logRequest(params);
    } catch {
      // Logging failures should not break the main flow
    }
  }

  private async resolveObservability(
    options: GenerateObservabilityOptions & {systemPrompt?: string}
  ): Promise<ResolvedObservability> {
    let promptRef: PromptVersionRef | undefined;
    let systemPrompt = options.systemPrompt;
    let sensitive = options.sensitive ?? false;

    if (options.promptName) {
      const registry = getObservabilityApp()?.promptRegistry;
      if (!registry) {
        throw new APIError({status: 400, title: "Prompt registry is not configured"});
      }
      const label = options.promptLabel ?? "production";
      const version = await registry.get({label, name: options.promptName});
      if (!version) {
        throw new APIError({
          status: 400,
          title: `Unknown prompt "${options.promptName}" with label "${label}"`,
        });
      }
      promptRef = version;
      systemPrompt = version.body;
      if (options.sensitive === undefined) {
        sensitive = Boolean(version.sensitive);
      }
    }

    return {
      priceMap: options.priceMap,
      promptRef,
      sensitive,
      sessionId: options.sessionId,
      skipTrace: options.skipTrace === true,
      systemPrompt,
    };
  }

  private observabilityFields(options: GenerateObservabilityOptions): GenerateObservabilityOptions {
    return {
      priceMap: options.priceMap,
      promptLabel: options.promptLabel,
      promptName: options.promptName,
      sensitive: options.sensitive,
      sessionId: options.sessionId,
      skipTrace: options.skipTrace,
    };
  }

  private buildTraceRecord(params: {
    error?: string;
    childSpans?: SpanRecord[];
    inputTokens?: number;
    metadata?: Record<string, unknown>;
    observability: ResolvedObservability;
    outputTokens?: number;
    prompt: string;
    requestType: AIRequestType;
    response?: string;
    responseTime: number;
    startTime: number;
    userId?: mongoose.Types.ObjectId;
  }): TraceRecord {
    const modelId = getModelId(this.model);
    const priceMap = params.observability.priceMap;
    const app = getObservabilityApp();
    const effectivePriceMap = priceMap ?? app?.priceMap;
    const costUsd = computeCostUsd({
      inputTokens: params.inputTokens,
      modelId,
      outputTokens: params.outputTokens,
      priceMap: effectivePriceMap,
    });
    const usage = {
      inputTokens: params.inputTokens,
      model: modelId,
      outputTokens: params.outputTokens,
      ...(costUsd === undefined ? {} : {costUsd}),
    };
    const status = params.error ? "error" : "ok";
    const startedAt = toIsoUtc(params.startTime);
    const endedAt = toIsoUtc(params.startTime + params.responseTime);
    const spanName = params.observability.promptRef?.name ?? params.requestType;
    const childSpans = params.childSpans ?? [];
    let spans: SpanRecord[];

    if (childSpans.length > 0) {
      const rootId = randomUUID();
      const rootSpan: SpanRecord = {
        durationMs: params.responseTime,
        endedAt,
        id: rootId,
        input: params.prompt,
        kind: "CHAIN",
        name: spanName,
        output: params.response,
        startedAt,
        status,
        usage,
        ...(params.error ? {error: params.error} : {}),
      };
      spans = [
        rootSpan,
        ...childSpans.map((child) => {
          return {
            ...child,
            parentSpanId: child.parentSpanId ?? rootId,
          };
        }),
      ];
    } else {
      spans = [
        {
          durationMs: params.responseTime,
          endedAt,
          id: randomUUID(),
          input: params.prompt,
          kind: "LLM",
          name: spanName,
          output: params.response,
          startedAt,
          status,
          usage,
          ...(params.error ? {error: params.error} : {}),
        },
      ];
    }

    const promptRef = params.observability.promptRef;
    return {
      endedAt,
      id: randomUUID(),
      input: params.prompt,
      name: spanName,
      output: params.response,
      prompts: promptRef
        ? [{label: promptRef.label, name: promptRef.name, version: promptRef.version}]
        : [],
      sensitive: params.observability.sensitive,
      sessionId: params.observability.sessionId,
      spans,
      startedAt,
      status,
      usage,
      userId: params.userId?.toString(),
      ...(params.error ? {errorSummary: params.error} : {}),
    };
  }

  private async logRequestAndTrace(params: {
    error?: string;
    childSpans?: SpanRecord[];
    inputTokens?: number;
    metadata?: Record<string, unknown>;
    observability: ResolvedObservability;
    outputTokens?: number;
    prompt: string;
    requestType: AIRequestType;
    response?: string;
    responseTime: number;
    startTime: number;
    tokensUsed?: number;
    userId?: mongoose.Types.ObjectId;
  }): Promise<void> {
    await this.logRequest({
      aiModel: getModelId(this.model),
      error: params.error,
      metadata: {
        ...params.metadata,
        ...(params.inputTokens === undefined ? {} : {inputTokens: params.inputTokens}),
        ...(params.outputTokens === undefined ? {} : {outputTokens: params.outputTokens}),
      },
      prompt: params.prompt,
      requestType: params.requestType,
      response: params.response,
      responseTime: params.responseTime,
      tokensUsed: params.tokensUsed,
      userId: params.userId,
    });

    const app = getObservabilityApp();
    if (!app || params.observability.skipTrace) {
      return;
    }

    const trace = this.buildTraceRecord({
      childSpans: params.childSpans,
      error: params.error,
      inputTokens: params.inputTokens,
      observability: params.observability,
      outputTokens: params.outputTokens,
      prompt: params.prompt,
      requestType: params.requestType,
      response: params.response,
      responseTime: params.responseTime,
      startTime: params.startTime,
      userId: params.userId,
    });

    const results = await Promise.allSettled(
      app.traceSinks.map((sink) => {
        return sink.export(trace);
      })
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("Observability TraceSink.export failed", {error: result.reason});
      }
    }
  }

  async resolveGenerateObservability(
    options: GenerateObservabilityOptions & {systemPrompt?: string}
  ): Promise<ResolvedObservability> {
    return this.resolveObservability(options);
  }

  async recordGenerate(params: {
    childSpans?: SpanRecord[];
    error?: string;
    inputTokens?: number;
    metadata?: Record<string, unknown>;
    observability: ResolvedObservability;
    outputTokens?: number;
    prompt: string;
    requestType: AIRequestType;
    response?: string;
    responseTime: number;
    startTime: number;
    tokensUsed?: number;
    userId?: mongoose.Types.ObjectId;
  }): Promise<void> {
    await this.logRequestAndTrace(params);
  }

  async generateText(options: GenerateTextOptions): Promise<string> {
    const observability = await this.resolveObservability(options);
    const {prompt, temperature, maxOutputTokens, userId} = options;
    const startTime = DateTime.now().toMillis();

    try {
      const result = await aiGenerateText({
        experimental_telemetry: {functionId: "generate-text", isEnabled: true},
        maxOutputTokens,
        model: this.model,
        prompt,
        system: observability.systemPrompt,
        temperature: temperature ?? this.defaultTemperature,
      });

      const responseTime = DateTime.now().toMillis() - startTime;
      const tokens = readTokenUsage(result.usage);
      await this.logRequestAndTrace({
        inputTokens: tokens.inputTokens,
        observability,
        outputTokens: tokens.outputTokens,
        prompt,
        requestType: "general",
        response: result.text,
        responseTime,
        startTime,
        tokensUsed: tokens.totalTokens,
        userId,
      });

      return result.text;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logRequestAndTrace({
        error: error instanceof Error ? error.message : String(error),
        observability,
        prompt,
        requestType: "general",
        responseTime,
        startTime,
        userId,
      });
      throw error;
    }
  }

  /** Any JSON value (object, array, primitive, or null) via the AI SDK `Output.json()` parser. */
  async generateJsonValue(options: GenerateJsonValueOptions): Promise<JSONValue> {
    const observability = await this.resolveObservability({
      ...options,
      systemPrompt: options.systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT,
    });
    const {maxOutputTokens, outputDescription, outputName, prompt, temperature, userId} = options;
    const startTime = DateTime.now().toMillis();
    const system = observability.systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT;

    try {
      const result = await aiGenerateText({
        experimental_telemetry: {functionId: "generate-json-value", isEnabled: true},
        maxOutputTokens,
        model: this.getModelForStructuredJson(),
        output: Output.json({description: outputDescription, name: outputName}),
        prompt,
        system,
        temperature: temperature ?? TemperaturePresets.DETERMINISTIC,
      });

      const responseTime = DateTime.now().toMillis() - startTime;
      const tokens = readTokenUsage(result.usage);
      await this.logRequestAndTrace({
        inputTokens: tokens.inputTokens,
        observability,
        outputTokens: tokens.outputTokens,
        prompt,
        requestType: "json_value",
        response: JSON.stringify(result.output),
        responseTime,
        startTime,
        tokensUsed: tokens.totalTokens,
        userId,
      });

      return result.output;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logStructuredJsonFailure({
        error,
        observability,
        prompt,
        requestType: "json_value",
        responseTime,
        startTime,
        system,
        userId,
      });
      throw error;
    }
  }

  /** Typed object from a Zod schema, `jsonSchema(...)`, or other `FlexibleSchema` (`Output.object()`). */
  async generateJsonObject<OBJECT>(options: GenerateJsonObjectOptions<OBJECT>): Promise<OBJECT> {
    const observability = await this.resolveObservability({
      ...options,
      systemPrompt: options.systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT,
    });
    const {maxOutputTokens, prompt, schema, schemaDescription, schemaName, temperature, userId} =
      options;
    const startTime = DateTime.now().toMillis();
    const system = observability.systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT;

    try {
      const result = await aiGenerateText({
        experimental_telemetry: {functionId: "generate-json-object", isEnabled: true},
        maxOutputTokens,
        model: this.getModelForStructuredJson(),
        output: Output.object({
          description: schemaDescription,
          name: schemaName,
          schema,
        }),
        prompt,
        system,
        temperature: temperature ?? TemperaturePresets.DETERMINISTIC,
      });

      const responseTime = DateTime.now().toMillis() - startTime;
      const tokens = readTokenUsage(result.usage);
      await this.logRequestAndTrace({
        inputTokens: tokens.inputTokens,
        observability,
        outputTokens: tokens.outputTokens,
        prompt,
        requestType: "json_object",
        response: JSON.stringify(result.output),
        responseTime,
        startTime,
        tokensUsed: tokens.totalTokens,
        userId,
      });

      return result.output;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logStructuredJsonFailure({
        error,
        observability,
        prompt,
        requestType: "json_object",
        responseTime,
        startTime,
        system,
        userId,
      });
      throw error;
    }
  }

  /**
   * Typed array: the model is steered to emit `{"elements":[...]}`; the SDK validates each entry
   * and this method returns the plain array (`Output.array()`).
   */
  async generateJsonArray<ELEMENT>(
    options: GenerateJsonArrayOptions<ELEMENT>
  ): Promise<Array<ELEMENT>> {
    const observability = await this.resolveObservability({
      ...options,
      systemPrompt: options.systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT,
    });
    const {element, maxOutputTokens, outputDescription, outputName, prompt, temperature, userId} =
      options;
    const startTime = DateTime.now().toMillis();
    const system = observability.systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT;

    try {
      const result = await aiGenerateText({
        experimental_telemetry: {functionId: "generate-json-array", isEnabled: true},
        maxOutputTokens,
        model: this.getModelForStructuredJson(),
        output: Output.array({
          description: outputDescription,
          element,
          name: outputName,
        }),
        prompt,
        system,
        temperature: temperature ?? TemperaturePresets.DETERMINISTIC,
      });

      const responseTime = DateTime.now().toMillis() - startTime;
      const tokens = readTokenUsage(result.usage);
      await this.logRequestAndTrace({
        inputTokens: tokens.inputTokens,
        observability,
        outputTokens: tokens.outputTokens,
        prompt,
        requestType: "json_array",
        response: JSON.stringify(result.output),
        responseTime,
        startTime,
        tokensUsed: tokens.totalTokens,
        userId,
      });

      return result.output;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logStructuredJsonFailure({
        error,
        observability,
        prompt,
        requestType: "json_array",
        responseTime,
        startTime,
        system,
        userId,
      });
      throw error;
    }
  }

  async *generateTextStream(options: GenerateStreamOptions): AsyncGenerator<string> {
    const observability = await this.resolveObservability(options);
    const {prompt, temperature, maxOutputTokens, userId} = options;
    const startTime = DateTime.now().toMillis();
    let fullResponse = "";

    try {
      const result = streamText({
        experimental_telemetry: {functionId: "generate-text-stream", isEnabled: true},
        maxOutputTokens,
        model: this.model,
        prompt,
        system: observability.systemPrompt,
        temperature: temperature ?? this.defaultTemperature,
      });

      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        yield chunk;
      }

      const responseTime = DateTime.now().toMillis() - startTime;
      const usage = await result.usage;
      const tokens = readTokenUsage(usage);
      await this.logRequestAndTrace({
        inputTokens: tokens.inputTokens,
        observability,
        outputTokens: tokens.outputTokens,
        prompt,
        requestType: "general",
        response: fullResponse,
        responseTime,
        startTime,
        tokensUsed: tokens.totalTokens,
        userId,
      });
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logRequestAndTrace({
        error: error instanceof Error ? error.message : String(error),
        observability,
        prompt,
        requestType: "general",
        responseTime,
        startTime,
        userId,
      });
      throw error;
    }
  }

  async generateRemix(options: RemixOptions): Promise<string> {
    return this.generateText({
      ...this.observabilityFields(options),
      prompt: options.text,
      systemPrompt: REMIX_PROMPT,
      temperature: TemperaturePresets.BALANCED,
      userId: options.userId,
    });
  }

  async generateSummary(options: SummaryOptions): Promise<string> {
    return this.generateText({
      ...this.observabilityFields(options),
      prompt: options.text,
      systemPrompt: CONTENT_SUMMARY_PROMPT,
      temperature: TemperaturePresets.LOW,
      userId: options.userId,
    });
  }

  async translateText(options: TranslateOptions): Promise<string> {
    const {text, targetLanguage, sourceLanguage = "auto-detect", userId} = options;
    const systemPrompt = TRANSLATION_PROMPT.replace("{sourceLanguage}", sourceLanguage).replace(
      "{targetLanguage}",
      targetLanguage
    );

    return this.generateText({
      ...this.observabilityFields(options),
      prompt: text,
      systemPrompt,
      temperature: TemperaturePresets.LOW,
      userId,
    });
  }

  buildMessages(prompts: GptHistoryPrompt[]): ModelMessage[] {
    const messages: ModelMessage[] = [];

    for (const prompt of prompts) {
      if (prompt.type === "tool-call" || prompt.type === "tool-result") {
        continue;
      }
      // A reply still streaming (or one that failed before any output) is not a real turn yet
      if (
        prompt.status === "streaming" ||
        (prompt.status === "error" && !prompt.text && !prompt.content?.length)
      ) {
        continue;
      }

      const role = prompt.type as "user" | "assistant" | "system";

      if (prompt.content && prompt.content.length > 0 && role === "user") {
        const parts: Array<{
          type: string;
          text?: string;
          image?: DataContent | URL;
          data?: DataContent | URL;
          filename?: string;
          mediaType?: string;
        }> = [];
        for (const part of prompt.content) {
          if (part.type === "text") {
            parts.push({text: part.text, type: "text"});
          } else if (part.type === "image") {
            logger.debug("Building image message part", {
              mediaType: part.mimeType,
              urlPrefix: part.url?.substring(0, 50),
            });
            parts.push({image: new URL(part.url), mediaType: part.mimeType, type: "image"});
          } else if (part.type === "file") {
            logger.debug("Building file message part", {
              filename: part.filename,
              mediaType: part.mimeType,
              urlPrefix: part.url?.substring(0, 50),
            });
            parts.push({
              data: new URL(part.url),
              filename: part.filename,
              mediaType: part.mimeType,
              type: "file",
            });
          }
        }
        messages.push({content: parts, role: "user"} as ModelMessage);
      } else if (!prompt.text && prompt.content?.length) {
        // Providers reject empty assistant turns; stand in for an image-only response
        messages.push({content: "[Generated image]", role});
      } else {
        messages.push({content: prompt.text, role});
      }
    }

    return messages;
  }

  async *generateChatStream(options: GenerateChatStreamOptions): AsyncGenerator<string> {
    const observability = await this.resolveObservability({
      ...options,
      systemPrompt: options.systemPrompt ?? DEFAULT_GPT_MEMORY,
    });
    const {messages, tools, toolChoice, stopWhen, userId} = options;
    const startTime = DateTime.now().toMillis();
    let fullResponse = "";

    const promptText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

    try {
      const result = streamText({
        experimental_telemetry: {functionId: "generate-chat-stream", isEnabled: true},
        messages: messages.map((m) => ({content: m.content, role: m.role})),
        model: this.model,
        stopWhen: stopWhen ?? stepCountIs(1),
        system: observability.systemPrompt ?? DEFAULT_GPT_MEMORY,
        temperature: this.defaultTemperature,
        toolChoice,
        tools,
      });

      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        yield chunk;
      }

      const responseTime = DateTime.now().toMillis() - startTime;
      const usage = await result.usage;
      const tokens = readTokenUsage(usage);
      await this.logRequestAndTrace({
        inputTokens: tokens.inputTokens,
        observability,
        outputTokens: tokens.outputTokens,
        prompt: promptText,
        requestType: "general",
        response: fullResponse,
        responseTime,
        startTime,
        tokensUsed: tokens.totalTokens,
        userId,
      });
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logRequestAndTrace({
        error: error instanceof Error ? error.message : String(error),
        observability,
        prompt: promptText,
        requestType: "general",
        responseTime,
        startTime,
        userId,
      });
      throw error;
    }
  }
}
