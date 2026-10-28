import type {Mock} from "bun:test";

import {createMockGroup} from "./mockGroup";

export type MockLanguageModelFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other"
  | "unknown";

export interface MockLanguageModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface MockLanguageModelToolCall {
  /** Tool input; serialized to the JSON string the provider spec expects. */
  input: unknown;
  /** Default `call_<n>` (1-based across the response's calls). */
  toolCallId?: string;
  toolName: string;
}

/** One scripted model turn. Each `doGenerate`/`doStream` call consumes the next one. */
export interface MockLanguageModelResponse {
  /** Stream deltas. Default `[text]`. `doGenerate` returns `text`, or the joined chunks. */
  chunks?: string[];
  /** Makes the call fail: `doGenerate` rejects, `doStream` errors after the text deltas. */
  error?: string;
  /** Default `"tool-calls"` when `toolCalls` is set, otherwise `"stop"`. */
  finishReason?: MockLanguageModelFinishReason;
  text?: string;
  toolCalls?: MockLanguageModelToolCall[];
  usage?: MockLanguageModelUsage;
}

export interface MockLanguageModelStreamPart {
  type: string;
  [key: string]: unknown;
}

export interface MockLanguageModelGenerateResult {
  content: Array<
    | {text: string; type: "text"}
    | {input: string; toolCallId: string; toolName: string; type: "tool-call"}
  >;
  finishReason: MockLanguageModelFinishReason;
  usage: MockLanguageModelUsage;
  warnings: never[];
}

export interface CreateMockLanguageModelOptions {
  modelId?: string;
  provider?: string;
  /** Scripted turns, in order. The last one repeats once the script runs out. */
  responses?: MockLanguageModelResponse[];
  /** Shorthand for `responses: [{text}]`. Default `"Mock response"`. */
  text?: string;
}

/**
 * A Vercel AI SDK `LanguageModelV2` (spec `"v2"`, which AI SDK 5 and 6 accept) for passing
 * straight to `AIService`, `streamText`, or `generateText`. Assert on `doGenerate.mock.calls` /
 * `doStream.mock.calls` to see the prompt and tools the SDK sent.
 */
export interface MockLanguageModel {
  doGenerate: Mock<(options: unknown) => Promise<MockLanguageModelGenerateResult>>;
  doStream: Mock<
    (options: unknown) => Promise<{stream: ReadableStream<MockLanguageModelStreamPart>}>
  >;
  readonly modelId: string;
  readonly provider: string;
  /** Clears calls and overrides and restarts the script at the first response. */
  reset: () => void;
  readonly specificationVersion: "v2";
  readonly supportedUrls: Record<string, RegExp[]>;
}

const DEFAULT_USAGE: MockLanguageModelUsage = {inputTokens: 1, outputTokens: 1, totalTokens: 2};

const toolCallParts = (
  toolCalls: MockLanguageModelToolCall[] | undefined
): Array<{input: string; toolCallId: string; toolName: string; type: "tool-call"}> =>
  (toolCalls ?? []).map((call, index) => ({
    input: JSON.stringify(call.input ?? {}),
    toolCallId: call.toolCallId ?? `call_${index + 1}`,
    toolName: call.toolName,
    type: "tool-call",
  }));

const finishReasonFor = (response: MockLanguageModelResponse): MockLanguageModelFinishReason =>
  response.finishReason ?? (response.toolCalls?.length ? "tool-calls" : "stop");

/** Builds the `LanguageModelV2` stream parts a response produces. */
export const mockLanguageModelStreamParts = (
  response: MockLanguageModelResponse
): MockLanguageModelStreamPart[] => {
  const chunks = response.chunks ?? (response.text ? [response.text] : []);
  const textParts: MockLanguageModelStreamPart[] =
    chunks.length === 0
      ? []
      : [
          {id: "text-1", type: "text-start"},
          ...chunks.map((delta) => ({delta, id: "text-1", type: "text-delta"})),
          {id: "text-1", type: "text-end"},
        ];
  return [
    {type: "stream-start", warnings: []},
    ...textParts,
    ...toolCallParts(response.toolCalls),
    {
      finishReason: finishReasonFor(response),
      type: "finish",
      usage: response.usage ?? DEFAULT_USAGE,
    },
  ];
};

/**
 * Creates a scripted mock language model. Prefer this to `mock.module("ai", ...)`: the real AI SDK
 * runs, so tool loops, structured output, and streaming behave as in production. Needs no `ai`
 * install. For full-spec V3 fidelity, `MockLanguageModelV3` from `ai/test` is the SDK's own.
 */
export const createMockLanguageModel = (
  options: CreateMockLanguageModelOptions = {}
): MockLanguageModel => {
  const responses = options.responses?.length
    ? options.responses
    : [{text: options.text ?? "Mock response"}];
  const group = createMockGroup();
  let callCount = 0;

  const nextResponse = (): MockLanguageModelResponse => {
    const response = responses[Math.min(callCount, responses.length - 1)];
    callCount += 1;
    return response as MockLanguageModelResponse;
  };

  const doGenerate = group.fn(
    async (_options: unknown): Promise<MockLanguageModelGenerateResult> => {
      const response = nextResponse();
      if (response.error) {
        throw new Error(response.error);
      }
      const text = response.text ?? response.chunks?.join("");
      return {
        content: [
          ...(text ? [{text, type: "text" as const}] : []),
          ...toolCallParts(response.toolCalls),
        ],
        finishReason: finishReasonFor(response),
        usage: response.usage ?? DEFAULT_USAGE,
        warnings: [],
      };
    }
  );

  const doStream = group.fn(
    async (_options: unknown): Promise<{stream: ReadableStream<MockLanguageModelStreamPart>}> => {
      const response = nextResponse();
      const parts = mockLanguageModelStreamParts(response);
      let index = 0;
      // Pull one part at a time so parts before a scripted error still reach the reader.
      const stream = new ReadableStream<MockLanguageModelStreamPart>({
        pull: (controller): void => {
          const part = parts[index];
          index += 1;
          if (!part) {
            controller.close();
            return;
          }
          if (response.error && part.type !== "stream-start" && !part.type.startsWith("text")) {
            controller.error(new Error(response.error));
            return;
          }
          controller.enqueue(part);
        },
      });
      return {stream};
    }
  );

  return {
    doGenerate,
    doStream,
    modelId: options.modelId ?? "mock-model",
    provider: options.provider ?? "mock-provider",
    reset: (): void => {
      group.reset();
      callCount = 0;
    },
    specificationVersion: "v2",
    supportedUrls: {},
  };
};
