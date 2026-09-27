import {logger} from "@terreno/api";
import type {
  DataContent,
  JSONValue,
  LanguageModel,
  ModelMessage,
  ToolCallPart,
  ToolResultPart,
} from "ai";
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
import type {
  AIRequestType,
  AIServiceOptions,
  GenerateChatStreamOptions,
  GenerateJsonArrayOptions,
  GenerateJsonObjectOptions,
  GenerateJsonValueOptions,
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

/** Result rows of ask tool calls, by tool call id. */
const collectAskResults = (prompts: GptHistoryPrompt[]): Map<string, GptHistoryPrompt> => {
  const askCallIds = new Set(
    prompts
      .filter((prompt) => prompt.type === "tool-call" && prompt.ask && prompt.toolCallId)
      .map((prompt) => prompt.toolCallId)
  );
  return new Map(
    prompts
      .filter(
        (prompt): prompt is GptHistoryPrompt & {toolCallId: string} =>
          prompt.type === "tool-result" &&
          prompt.toolCallId !== undefined &&
          askCallIds.has(prompt.toolCallId)
      )
      .map((prompt) => [prompt.toolCallId, prompt])
  );
};

const getModelId = (model: LanguageModel): string => {
  if (typeof model === "string") {
    return model;
  }
  return (model as {modelId?: string}).modelId ?? "unknown";
};

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
    prompt: string;
    requestType: AIRequestType;
    responseTime: number;
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

    await this.logRequest({
      aiModel: getModelId(this.model),
      error: errorDescription,
      metadata: {
        errorStack,
        finishReason,
        rawModelTextCaptured: Boolean(rawText && rawText.length > 0),
        system: params.system,
      },
      prompt: params.prompt,
      requestType: params.requestType,
      response: responseForLog,
      responseTime: params.responseTime,
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

  async generateText(options: GenerateTextOptions): Promise<string> {
    const {prompt, systemPrompt, temperature, maxOutputTokens, userId} = options;
    const startTime = DateTime.now().toMillis();

    try {
      const result = await aiGenerateText({
        experimental_telemetry: {functionId: "generate-text", isEnabled: true},
        maxOutputTokens,
        model: this.model,
        prompt,
        system: systemPrompt,
        temperature: temperature ?? this.defaultTemperature,
      });

      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logRequest({
        aiModel: getModelId(this.model),
        prompt,
        requestType: "general",
        response: result.text,
        responseTime,
        tokensUsed: result.usage?.totalTokens,
        userId,
      });

      return result.text;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logRequest({
        aiModel: getModelId(this.model),
        error: error instanceof Error ? error.message : String(error),
        prompt,
        requestType: "general",
        responseTime,
        userId,
      });
      throw error;
    }
  }

  /** Any JSON value (object, array, primitive, or null) via the AI SDK `Output.json()` parser. */
  async generateJsonValue(options: GenerateJsonValueOptions): Promise<JSONValue> {
    const {
      maxOutputTokens,
      outputDescription,
      outputName,
      prompt,
      systemPrompt,
      temperature,
      userId,
    } = options;
    const startTime = DateTime.now().toMillis();
    const system = systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT;

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
      await this.logRequest({
        aiModel: getModelId(this.model),
        prompt,
        requestType: "json_value",
        response: JSON.stringify(result.output),
        responseTime,
        tokensUsed: result.usage?.totalTokens,
        userId,
      });

      return result.output;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logStructuredJsonFailure({
        error,
        prompt,
        requestType: "json_value",
        responseTime,
        system,
        userId,
      });
      throw error;
    }
  }

  /** Typed object from a Zod schema, `jsonSchema(...)`, or other `FlexibleSchema` (`Output.object()`). */
  async generateJsonObject<OBJECT>(options: GenerateJsonObjectOptions<OBJECT>): Promise<OBJECT> {
    const {
      maxOutputTokens,
      prompt,
      schema,
      schemaDescription,
      schemaName,
      systemPrompt,
      temperature,
      userId,
    } = options;
    const startTime = DateTime.now().toMillis();
    const system = systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT;

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
      await this.logRequest({
        aiModel: getModelId(this.model),
        prompt,
        requestType: "json_object",
        response: JSON.stringify(result.output),
        responseTime,
        tokensUsed: result.usage?.totalTokens,
        userId,
      });

      return result.output;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logStructuredJsonFailure({
        error,
        prompt,
        requestType: "json_object",
        responseTime,
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
    const {
      element,
      maxOutputTokens,
      outputDescription,
      outputName,
      prompt,
      systemPrompt,
      temperature,
      userId,
    } = options;
    const startTime = DateTime.now().toMillis();
    const system = systemPrompt ?? JSON_VALUE_SYSTEM_PROMPT;

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
      await this.logRequest({
        aiModel: getModelId(this.model),
        prompt,
        requestType: "json_array",
        response: JSON.stringify(result.output),
        responseTime,
        tokensUsed: result.usage?.totalTokens,
        userId,
      });

      return result.output;
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logStructuredJsonFailure({
        error,
        prompt,
        requestType: "json_array",
        responseTime,
        system,
        userId,
      });
      throw error;
    }
  }

  async *generateTextStream(options: GenerateStreamOptions): AsyncGenerator<string> {
    const {prompt, systemPrompt, temperature, maxOutputTokens, userId} = options;
    const startTime = DateTime.now().toMillis();
    let fullResponse = "";

    try {
      const result = streamText({
        experimental_telemetry: {functionId: "generate-text-stream", isEnabled: true},
        maxOutputTokens,
        model: this.model,
        prompt,
        system: systemPrompt,
        temperature: temperature ?? this.defaultTemperature,
      });

      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        yield chunk;
      }

      const responseTime = DateTime.now().toMillis() - startTime;
      const usage = await result.usage;
      await this.logRequest({
        aiModel: getModelId(this.model),
        prompt,
        requestType: "general",
        response: fullResponse,
        responseTime,
        tokensUsed: usage?.totalTokens,
        userId,
      });
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logRequest({
        aiModel: getModelId(this.model),
        error: error instanceof Error ? error.message : String(error),
        prompt,
        requestType: "general",
        responseTime,
        userId,
      });
      throw error;
    }
  }

  async generateRemix(options: RemixOptions): Promise<string> {
    return this.generateText({
      prompt: options.text,
      systemPrompt: REMIX_PROMPT,
      temperature: TemperaturePresets.BALANCED,
      userId: options.userId,
    });
  }

  async generateSummary(options: SummaryOptions): Promise<string> {
    return this.generateText({
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
      prompt: text,
      systemPrompt,
      temperature: TemperaturePresets.LOW,
      userId,
    });
  }

  /**
   * Converts history rows to model messages. Ask call/result pairs are kept so the model sees what
   * it asked and how the user answered; other tool rows, and asks still waiting for an answer, are
   * skipped. Consecutive ask calls came from one step and share one assistant message.
   */
  buildMessages(prompts: GptHistoryPrompt[]): ModelMessage[] {
    const messages: ModelMessage[] = [];
    const askResults = collectAskResults(prompts);
    let askStep: {calls: ToolCallPart[]; results: ToolResultPart[]} | undefined;

    for (const prompt of prompts) {
      if (prompt.type === "tool-call" && prompt.ask) {
        const askResult = prompt.toolCallId ? askResults.get(prompt.toolCallId) : undefined;
        if (!askResult || !prompt.toolCallId || !prompt.toolName) {
          continue;
        }
        if (!askStep) {
          askStep = {calls: [], results: []};
          messages.push(
            {content: askStep.calls, role: "assistant"},
            {content: askStep.results, role: "tool"}
          );
        }
        askStep.calls.push({
          input: prompt.args ?? {},
          toolCallId: prompt.toolCallId,
          toolName: prompt.toolName,
          type: "tool-call",
        });
        askStep.results.push({
          output: {type: "json", value: (askResult.result ?? null) as JSONValue},
          toolCallId: prompt.toolCallId,
          toolName: prompt.toolName,
          type: "tool-result",
        });
        continue;
      }
      askStep = undefined;

      if (prompt.type === "tool-call" || prompt.type === "tool-result") {
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
      } else {
        messages.push({content: prompt.text, role});
      }
    }

    return messages;
  }

  async *generateChatStream(options: GenerateChatStreamOptions): AsyncGenerator<string> {
    const {messages, systemPrompt, tools, toolChoice, stopWhen, userId} = options;
    const startTime = DateTime.now().toMillis();
    let fullResponse = "";

    const promptText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

    try {
      const result = streamText({
        experimental_telemetry: {functionId: "generate-chat-stream", isEnabled: true},
        messages: messages.map((m) => ({content: m.content, role: m.role})),
        model: this.model,
        stopWhen: stopWhen ?? stepCountIs(1),
        system: systemPrompt ?? DEFAULT_GPT_MEMORY,
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
      await this.logRequest({
        aiModel: getModelId(this.model),
        prompt: promptText,
        requestType: "general",
        response: fullResponse,
        responseTime,
        tokensUsed: usage?.totalTokens,
        userId,
      });
    } catch (error) {
      const responseTime = DateTime.now().toMillis() - startTime;
      await this.logRequest({
        aiModel: getModelId(this.model),
        error: error instanceof Error ? error.message : String(error),
        prompt: promptText,
        requestType: "general",
        responseTime,
        userId,
      });
      throw error;
    }
  }
}
