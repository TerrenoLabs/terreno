import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {APIError} from "@terreno/api";
import {jsonSchema, type LanguageModel} from "ai";
import {assert} from "chai";
import mongoose from "mongoose";

import {AIRequest} from "../models/aiRequest";
import {MemoryTraceSink} from "../observability/local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observability/observabilityApp";
import type {ObservabilityPlugin, PromptVersionRef} from "../observability/types";
import {AIService, TemperaturePresets} from "./aiService";

// Create a mock LanguageModelV2
const createMockModel = (responseText = "Mock response") => {
  return {
    doGenerate: mock(async () => ({
      content: [{text: responseText, type: "text" as const}],
      finishReason: "stop" as const,
      usage: {inputTokens: 5, outputTokens: 10},
    })),
    doStream: mock(async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({id: "t1", type: "text-start" as const});
          controller.enqueue({delta: "Mock ", id: "t1", type: "text-delta" as const});
          controller.enqueue({delta: "response", id: "t1", type: "text-delta" as const});
          controller.enqueue({id: "t1", type: "text-end" as const});
          controller.enqueue({
            finishReason: "stop" as const,
            type: "finish" as const,
            usage: {inputTokens: 5, outputTokens: 10},
          });
          controller.close();
        },
      }),
    })),
    modelId: "mock-model",
    provider: "mock-provider",
    specificationVersion: "v2" as const,
    supportedUrls: {},
  };
};

describe("AIService", () => {
  beforeEach(async () => {
    await AIRequest.deleteMany({});
  });

  afterEach(async () => {
    await AIRequest.deleteMany({});
    resetObservabilityApp();
  });

  describe("constructor", () => {
    it("should create an instance with default temperature", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});
      expect(service).toBeDefined();
    });

    it("should create an instance with custom temperature", () => {
      const model = createMockModel();
      const service = new AIService({
        defaultTemperature: TemperaturePresets.LOW,
        model: model as unknown as LanguageModel,
      });
      expect(service).toBeDefined();
    });
  });

  describe("generateText", () => {
    it("should generate text and log the request", async () => {
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});
      const userId = new mongoose.Types.ObjectId();

      const result = await service.generateText({
        prompt: "Say hello",
        userId,
      });

      expect(result).toBe("Hello world");

      // Verify request was logged
      const logs = await AIRequest.find({userId});
      expect(logs.length).toBe(1);
      expect(logs[0].prompt).toBe("Say hello");
      expect(logs[0].response).toBe("Hello world");
      expect(logs[0].aiModel).toBe("mock-model");
      expect(logs[0].requestType).toBe("general");
    });

    it("should log errors on failure", async () => {
      const model = createMockModel();
      model.doGenerate = mock(async () => {
        throw new Error("API error");
      });
      const service = new AIService({model: model as unknown as LanguageModel});

      await expect(service.generateText({prompt: "test"})).rejects.toThrow("API error");

      const logs = await AIRequest.find({});
      expect(logs.length).toBe(1);
      expect(logs[0].error).toBe("API error");
    });
  });

  describe("generateJsonValue", () => {
    it("parses JSON, returns the value, and logs json_value", async () => {
      const model = createMockModel('{"ok":true,"n":3}');
      const service = new AIService({model: model as unknown as LanguageModel});
      const userId = new mongoose.Types.ObjectId();

      const result = await service.generateJsonValue({
        prompt: "Return a small object",
        userId,
      });

      expect(result).toEqual({n: 3, ok: true});

      const logs = await AIRequest.find({userId});
      expect(logs.length).toBe(1);
      expect(logs[0].requestType).toBe("json_value");
      expect(JSON.parse(logs[0].response ?? "{}")).toEqual({n: 3, ok: true});
    });

    it("parses JSON wrapped in markdown fences (including ```json:)", async () => {
      const model = createMockModel('```json:\n{"colon":true}\n```');
      const service = new AIService({model: model as unknown as LanguageModel});

      const result = await service.generateJsonValue({
        prompt: "Return JSON",
      });

      expect(result).toEqual({colon: true});
    });

    it("parses JSON wrapped in a generic ```lang fence", async () => {
      const model = createMockModel("```typescript\n[1,2]\n```");
      const service = new AIService({model: model as unknown as LanguageModel});

      const result = await service.generateJsonValue({
        prompt: "Return JSON",
      });

      expect(result).toEqual([1, 2]);
    });

    it("logs errors when JSON output cannot be produced", async () => {
      const model = createMockModel("not-json");
      const service = new AIService({model: model as unknown as LanguageModel});

      await expect(service.generateJsonValue({prompt: "bad"})).rejects.toThrow();

      const logs = await AIRequest.find({prompt: "bad"});
      expect(logs.length).toBe(1);
      expect(logs[0].error).toBeTruthy();
      expect(logs[0].requestType).toBe("json_value");
      expect(logs[0].response).toBe("not-json");
      expect(logs[0].metadata?.rawModelTextCaptured).toBe(true);
    });
  });

  describe("generateJsonObject", () => {
    it("parses against a schema and logs json_object", async () => {
      const model = createMockModel('{"id":"item-1","count":2}');
      const service = new AIService({model: model as unknown as LanguageModel});
      const userId = new mongoose.Types.ObjectId();

      const schema = jsonSchema<{count: number; id: string}>({
        additionalProperties: false,
        properties: {
          count: {type: "number"},
          id: {type: "string"},
        },
        required: ["id", "count"],
        type: "object",
      });

      const result = await service.generateJsonObject({
        prompt: "Extract fields",
        schema,
        userId,
      });

      expect(result).toEqual({count: 2, id: "item-1"});

      const logs = await AIRequest.find({userId});
      expect(logs[0].requestType).toBe("json_object");
    });

    it("parses object output wrapped in markdown fences", async () => {
      const model = createMockModel('```json\n{"id":"fenced","count":9}\n```');
      const service = new AIService({model: model as unknown as LanguageModel});

      const schema = jsonSchema<{count: number; id: string}>({
        additionalProperties: false,
        properties: {
          count: {type: "number"},
          id: {type: "string"},
        },
        required: ["id", "count"],
        type: "object",
      });

      const result = await service.generateJsonObject({
        prompt: "Extract fields",
        schema,
      });

      expect(result).toEqual({count: 9, id: "fenced"});
    });

    it("parses object output that has a prose preamble and a trailing comma", async () => {
      const model = createMockModel(
        'Sure! Here is the object you asked for:\n{"id":"messy","count":4,}\nLet me know if you need more.'
      );
      const service = new AIService({model: model as unknown as LanguageModel});

      const schema = jsonSchema<{count: number; id: string}>({
        additionalProperties: false,
        properties: {
          count: {type: "number"},
          id: {type: "string"},
        },
        required: ["id", "count"],
        type: "object",
      });

      const result = await service.generateJsonObject({
        prompt: "Extract fields",
        schema,
      });

      assert.deepEqual(result, {count: 4, id: "messy"});
    });

    it("logs a sentinel response when the model returns no text content", async () => {
      const model = createMockModel();
      model.doGenerate = mock(async () => ({
        content: [],
        finishReason: "stop" as const,
        usage: {inputTokens: 5, outputTokens: 0},
      }));
      const service = new AIService({model: model as unknown as LanguageModel});
      const schema = jsonSchema<{id: string}>({
        properties: {id: {type: "string"}},
        required: ["id"],
        type: "object",
      });

      await expect(
        service.generateJsonObject({prompt: "no content", schema})
      ).rejects.toBeDefined();

      const logs = await AIRequest.find({prompt: "no content"});
      assert.lengthOf(logs, 1);
      assert.equal(logs[0].requestType, "json_object");
      assert.isOk(logs[0].error);
      assert.notEqual(logs[0].metadata?.rawModelTextCaptured, true);
    });
  });

  describe("generateJsonArray", () => {
    it("parses an array against an element schema and logs json_array", async () => {
      const model = createMockModel('{"elements":[10,20,30]}');
      const service = new AIService({model: model as unknown as LanguageModel});
      const userId = new mongoose.Types.ObjectId();

      const element = jsonSchema<number>({type: "number"});

      const result = await service.generateJsonArray({
        element,
        prompt: "List numbers",
        userId,
      });

      expect(result).toEqual([10, 20, 30]);

      const logs = await AIRequest.find({userId});
      expect(logs[0].requestType).toBe("json_array");
    });

    it("parses array payload when model wraps elements in markdown fences", async () => {
      const model = createMockModel('```json\n{"elements":[1,2]}\n```');
      const service = new AIService({model: model as unknown as LanguageModel});
      const element = jsonSchema<number>({type: "number"});

      const result = await service.generateJsonArray({
        element,
        prompt: "List numbers",
      });

      expect(result).toEqual([1, 2]);
    });

    it("logs the raw model text when the array payload cannot be parsed", async () => {
      const model = createMockModel("sorry, I cannot do that");
      const service = new AIService({model: model as unknown as LanguageModel});
      const element = jsonSchema<number>({type: "number"});

      await expect(service.generateJsonArray({element, prompt: "bad array"})).rejects.toBeDefined();

      const logs = await AIRequest.find({prompt: "bad array"});
      assert.lengthOf(logs, 1);
      assert.equal(logs[0].requestType, "json_array");
      assert.equal(logs[0].response, "sorry, I cannot do that");
      assert.isTrue(logs[0].metadata?.rawModelTextCaptured);
    });
  });

  describe("generateTextStream", () => {
    it("should stream text chunks", async () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const chunks: string[] = [];
      for await (const chunk of service.generateTextStream({prompt: "test"})) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toBe("Mock response");
    });
  });

  describe("generateRemix", () => {
    it("should remix text", async () => {
      const model = createMockModel("Remixed text");
      const service = new AIService({model: model as unknown as LanguageModel});

      const result = await service.generateRemix({text: "Original text"});
      expect(result).toBe("Remixed text");
    });
  });

  describe("generateSummary", () => {
    it("should summarize text", async () => {
      const model = createMockModel("Summary of the text");
      const service = new AIService({model: model as unknown as LanguageModel});

      const result = await service.generateSummary({text: "Long text to summarize"});
      expect(result).toBe("Summary of the text");
    });
  });

  describe("translateText", () => {
    it("should translate text", async () => {
      const model = createMockModel("Hola mundo");
      const service = new AIService({model: model as unknown as LanguageModel});

      const result = await service.translateText({
        targetLanguage: "Spanish",
        text: "Hello world",
      });
      expect(result).toBe("Hola mundo");
    });

    it("should translate text with explicit sourceLanguage", async () => {
      const model = createMockModel("Bonjour le monde");
      const service = new AIService({model: model as unknown as LanguageModel});

      const result = await service.translateText({
        sourceLanguage: "English",
        targetLanguage: "French",
        text: "Hello world",
      });
      expect(result).toBe("Bonjour le monde");
    });
  });

  describe("modelId getter", () => {
    it("should return the model id from the underlying model", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      expect(service.modelId).toBe("mock-model");
    });

    it("should return 'unknown' when model has no modelId", () => {
      const model = {
        doGenerate: mock(async () => ({
          content: [],
          finishReason: "stop" as const,
          usage: {inputTokens: 0, outputTokens: 0},
        })),
        doStream: mock(async () => ({stream: new ReadableStream()})),
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const service = new AIService({model: model as unknown as LanguageModel});

      expect(service.modelId).toBe("unknown");
    });
  });

  describe("generateTextStream", () => {
    it("should log errors when the stream throws", async () => {
      const model = createMockModel();
      model.doStream = mock(async () => {
        throw new Error("Stream API error");
      });
      const service = new AIService({model: model as unknown as LanguageModel});

      const run = async () => {
        const chunks: string[] = [];
        for await (const chunk of service.generateTextStream({prompt: "stream test"})) {
          chunks.push(chunk);
        }
      };

      await expect(run()).rejects.toThrow();

      const logs = await AIRequest.find({prompt: "stream test"});
      expect(logs.length).toBe(1);
      expect(logs[0].error).toBeTruthy();
    });
  });

  describe("buildMessages file content", () => {
    it("should convert multi-modal user prompts with file content", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const messages = service.buildMessages([
        {
          content: [
            {text: "Please review this file", type: "text" as const},
            {
              filename: "report.pdf",
              mimeType: "application/pdf",
              type: "file" as const,
              url: "https://example.com/report.pdf",
            },
          ],
          text: "Please review this file",
          type: "user",
        },
      ]);

      expect(messages.length).toBe(1);
      const content = (
        messages[0] as {content: Array<{type: string; filename?: string; mediaType?: string}>}
      ).content;
      expect(content.length).toBe(2);
      expect(content[1].type).toBe("file");
      expect(content[1].filename).toBe("report.pdf");
      expect(content[1].mediaType).toBe("application/pdf");
    });
  });

  describe("generateChatStream", () => {
    it("should stream chat responses and log the request", async () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});
      const userId = new mongoose.Types.ObjectId();

      const chunks: string[] = [];
      for await (const chunk of service.generateChatStream({
        messages: [{content: "Hello", role: "user"}],
        userId,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe("Mock response");

      const logs = await AIRequest.find({userId});
      expect(logs.length).toBe(1);
      expect(logs[0].prompt).toContain("user: Hello");
      expect(logs[0].response).toBe("Mock response");
      expect(logs[0].aiModel).toBe("mock-model");
    });

    it("should log errors when chat stream fails", async () => {
      const model = createMockModel();
      model.doStream = mock(async () => {
        throw new Error("Chat stream failed");
      });
      const service = new AIService({model: model as unknown as LanguageModel});

      const run = async () => {
        const chunks: string[] = [];
        for await (const chunk of service.generateChatStream({
          messages: [{content: "Hi", role: "user"}],
        })) {
          chunks.push(chunk);
        }
      };

      await expect(run()).rejects.toThrow();

      const logs = await AIRequest.find({});
      const errLog = logs.find((log) => Boolean(log.error));
      expect(errLog).toBeDefined();
    });

    it("should accept systemPrompt override", async () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const chunks: string[] = [];
      for await (const chunk of service.generateChatStream({
        messages: [{content: "Hi", role: "user"}],
        systemPrompt: "You are a test assistant",
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe("Mock response");
    });
  });

  describe("buildMessages", () => {
    it("should convert simple text prompts to CoreMessages", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const messages = service.buildMessages([
        {text: "Hello", type: "user"},
        {text: "Hi there!", type: "assistant"},
        {text: "How are you?", type: "user"},
      ]);

      expect(messages.length).toBe(3);
      expect(messages[0]).toEqual({content: "Hello", role: "user"});
      expect(messages[1]).toEqual({content: "Hi there!", role: "assistant"});
      expect(messages[2]).toEqual({content: "How are you?", role: "user"});
    });

    it("should give image-only assistant prompts stand-in text", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const messages = service.buildMessages([
        {text: "Make an image", type: "user"},
        {
          content: [
            {mimeType: "image/png", type: "image" as const, url: "data:image/png;base64,aGVsbG8="},
          ],
          text: "",
          type: "assistant",
        },
      ]);

      expect(messages[1]).toEqual({content: "[Generated image]", role: "assistant"});
    });

    it("skips streaming placeholders and empty failed replies", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const messages = service.buildMessages([
        {text: "First", type: "user"},
        {status: "error", text: "", type: "assistant"},
        {text: "Second", type: "user"},
        {status: "error", text: "Partial answer", type: "assistant"},
        {text: "Third", type: "user"},
        {status: "streaming", text: "Half", type: "assistant"},
      ]);

      expect(messages).toEqual([
        {content: "First", role: "user"},
        {content: "Second", role: "user"},
        {content: "Partial answer", role: "assistant"},
        {content: "Third", role: "user"},
      ]);
    });

    it("should convert multi-modal user prompts with image content", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const messages = service.buildMessages([
        {
          content: [
            {text: "What is this?", type: "text" as const},
            {mimeType: "image/jpeg", type: "image" as const, url: "https://example.com/img.jpg"},
          ],
          text: "What is this?",
          type: "user",
        },
      ]);

      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("user");
      const content = (messages[0] as {content: Array<{type: string; text?: string}>}).content;
      expect(content.length).toBe(2);
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("What is this?");
      expect(content[1].type).toBe("image");
    });

    it("should skip tool-call and tool-result prompts", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const messages = service.buildMessages([
        {text: "What time is it?", type: "user"},
        {
          args: {},
          text: "Tool call: get_time",
          toolCallId: "c1",
          toolName: "get_time",
          type: "tool-call",
        },
        {
          result: "12:00",
          text: "Tool result: get_time",
          toolCallId: "c1",
          toolName: "get_time",
          type: "tool-result",
        },
        {text: "The time is 12:00", type: "assistant"},
      ]);

      expect(messages.length).toBe(2);
      expect(messages[0]).toEqual({content: "What time is it?", role: "user"});
      expect(messages[1]).toEqual({content: "The time is 12:00", role: "assistant"});
    });

    it("should handle system messages", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const messages = service.buildMessages([
        {text: "You are helpful", type: "system"},
        {text: "Hello", type: "user"},
      ]);

      expect(messages.length).toBe(2);
      expect(messages[0]).toEqual({content: "You are helpful", role: "system"});
    });
  });

  describe("generateChatStream", () => {
    it("streams chat responses and logs usage", async () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});
      const userId = new mongoose.Types.ObjectId();

      const chunks: string[] = [];
      for await (const chunk of service.generateChatStream({
        messages: [{content: "Hi", role: "user"}],
        systemPrompt: "You are helpful",
        userId,
      })) {
        chunks.push(chunk);
      }
      expect(chunks.join("")).toBe("Mock response");

      const logs = await AIRequest.find({userId});
      expect(logs.length).toBe(1);
      expect(logs[0].response).toBe("Mock response");
    });

    it("logs errors from the stream", async () => {
      const model = createMockModel();
      model.doStream = mock(async () => {
        throw new Error("stream failure");
      });
      const service = new AIService({model: model as unknown as LanguageModel});
      let threw = false;
      try {
        for await (const _chunk of service.generateChatStream({
          messages: [{content: "Hi", role: "user"}],
        })) {
          // consume
        }
      } catch (err) {
        threw = true;
        expect(err).toBeDefined();
      }
      expect(threw).toBe(true);

      const logs = await AIRequest.find({});
      const errored = logs.find((l) => !!l.error);
      expect(errored).toBeDefined();
    });
  });

  describe("buildMessages file parts", () => {
    it("includes file parts from multi-modal user prompts", () => {
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});
      const messages = service.buildMessages([
        {
          content: [
            {text: "Look", type: "text" as const},
            {
              filename: "doc.pdf",
              mimeType: "application/pdf",
              type: "file" as const,
              url: "https://example.com/doc.pdf",
            },
          ],
          text: "Look",
          type: "user",
        },
      ]);
      const content = (messages[0] as {content: Array<{type: string; filename?: string}>}).content;
      expect(content[1].type).toBe("file");
      expect(content[1].filename).toBe("doc.pdf");
    });
  });

  describe("observability traces and prompt resolve", () => {
    const PRODUCTION_BODY = "You are the production greeter.";
    const productionVersion: PromptVersionRef = {
      body: PRODUCTION_BODY,
      label: "production",
      name: "greeter",
      sensitive: true,
      version: 2,
    };

    const registerLocalApp = ({
      priceMap,
      promptVersion,
      traceSink,
    }: {
      priceMap?: {inputPerMTok: number; outputPerMTok: number};
      promptVersion?: PromptVersionRef;
      traceSink: MemoryTraceSink | {export: (trace: unknown) => Promise<void>};
    }): void => {
      const plugin: ObservabilityPlugin = {
        capabilities: new Set([
          "datasets",
          "experiments",
          "prompts",
          "reviewQueue",
          "scores",
          "traces",
        ]),
        datasetStore: {},
        experimentRunner: {},
        id: "local",
        promptRegistry: {
          get: async ({label, name}) => {
            if (!promptVersion) {
              return undefined;
            }
            if (name === promptVersion.name && (label ?? "production") === promptVersion.label) {
              return promptVersion;
            }
            return undefined;
          },
        },
        reviewQueue: {},
        traceSink: traceSink as MemoryTraceSink,
      };
      new ObservabilityApp({
        plugins: [plugin],
        priceMap: priceMap ? {"mock-model": priceMap} : undefined,
      });
    };

    it("exports a trace to every TraceSink", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({traceSink: sink});
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});
      const userId = new mongoose.Types.ObjectId();

      await service.generateText({
        prompt: "Say hello",
        sessionId: "sess-1",
        userId,
      });

      expect(sink.traces.length).toBe(1);
      expect(sink.traces[0].userId).toBe(userId.toString());
      expect(sink.traces[0].sessionId).toBe("sess-1");
      expect(sink.traces[0].status).toBe("ok");
      expect(sink.traces[0].spans[0].kind).toBe("LLM");
      expect("costUsd" in (sink.traces[0].usage ?? {})).toBe(false);
    });

    it("exports a CHAIN root with TOOL children when childSpans are provided", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({traceSink: sink});
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});
      const observability = await service.resolveGenerateObservability({});

      await service.recordGenerate({
        childSpans: [
          {
            durationMs: 5,
            endedAt: "2026-01-01T00:00:00.005Z",
            id: "tool-span",
            input: {q: "hello"},
            kind: "TOOL",
            name: "search",
            output: {results: ["item1"]},
            startedAt: "2026-01-01T00:00:00.000Z",
            status: "ok",
          },
        ],
        observability,
        prompt: "search",
        requestType: "general",
        response: "done",
        responseTime: 12,
        startTime: Date.parse("2026-01-01T00:00:00.000Z"),
      });

      assert.equal(sink.traces.length, 1);
      assert.equal(sink.traces[0].spans[0]?.kind, "CHAIN");
      assert.equal(sink.traces[0].spans.length, 2);
      const toolSpan = sink.traces[0].spans.find((span) => span.kind === "TOOL");
      assert.isDefined(toolSpan);
      assert.equal(toolSpan?.parentSpanId, sink.traces[0].spans[0]?.id);
      assert.deepEqual(toolSpan?.input, {q: "hello"});
      assert.deepEqual(toolSpan?.output, {results: ["item1"]});
    });

    it("does not export a trace when skipTrace is true", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({traceSink: sink});
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      await service.generateText({prompt: "Say hello", skipTrace: true});

      expect(sink.traces.length).toBe(0);
      const logs = await AIRequest.find({prompt: "Say hello"});
      expect(logs.length).toBe(1);
    });

    it("logs a throwing sink and still writes AIRequest", async () => {
      registerLocalApp({
        traceSink: {
          export: async () => {
            throw new Error("sink down");
          },
        },
      });
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      const result = await service.generateText({prompt: "Say hello"});

      expect(result).toBe("Hello world");
      const logs = await AIRequest.find({prompt: "Say hello"});
      expect(logs.length).toBe(1);
    });

    it("sets costUsd from the price map", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({
        priceMap: {inputPerMTok: 1000, outputPerMTok: 2000},
        traceSink: sink,
      });
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      await service.generateText({prompt: "Say hello"});

      expect(sink.traces[0].usage?.costUsd).toBeCloseTo(0.025);
    });

    it("omits costUsd when the model is unpriced", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({traceSink: sink});
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      await service.generateText({prompt: "Say hello"});

      expect(sink.traces[0].usage?.costUsd).toBeUndefined();
    });

    it("resolves promptName before the model call even when skipTrace is true", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({promptVersion: productionVersion, traceSink: sink});
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      await service.generateText({
        prompt: "User says hi",
        promptLabel: "production",
        promptName: "greeter",
        skipTrace: true,
      });

      expect(sink.traces.length).toBe(0);
      expect(model.doGenerate.mock.calls.length).toBe(1);
      const payload = JSON.stringify(model.doGenerate.mock.calls[0]);
      expect(payload).toContain(PRODUCTION_BODY);
    });

    it("returns 400 and does not call the model when the production label is missing", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({promptVersion: productionVersion, traceSink: sink});
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      try {
        await service.generateText({
          prompt: "User says hi",
          promptLabel: "production",
          promptName: "missing-prompt",
        });
        throw new Error("expected APIError");
      } catch (error) {
        expect(error).toBeInstanceOf(APIError);
        expect((error as APIError).status).toBe(400);
      }
      expect(model.doGenerate.mock.calls.length).toBe(0);
      expect(sink.traces.length).toBe(0);
    });

    it("returns 400 and does not call the model when no prompt registry is registered", async () => {
      resetObservabilityApp();
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      try {
        await service.generateText({
          prompt: "User says hi",
          promptName: "greeter",
        });
        throw new Error("expected APIError");
      } catch (error) {
        expect(error).toBeInstanceOf(APIError);
        expect((error as APIError).status).toBe(400);
      }
      expect(model.doGenerate.mock.calls.length).toBe(0);
    });

    it("inherits sensitive from the resolved prompt version", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({promptVersion: productionVersion, traceSink: sink});
      const model = createMockModel("Hello world");
      const service = new AIService({model: model as unknown as LanguageModel});

      await service.generateText({
        prompt: "User says hi",
        promptName: "greeter",
      });

      expect(sink.traces[0].sensitive).toBe(true);
      expect(sink.traces[0].prompts).toEqual([{label: "production", name: "greeter", version: 2}]);
    });

    it("still writes AIRequest for a chat stream when a sink is registered", async () => {
      const sink = new MemoryTraceSink();
      registerLocalApp({traceSink: sink});
      const model = createMockModel();
      const service = new AIService({model: model as unknown as LanguageModel});

      const chunks: string[] = [];
      for await (const chunk of service.generateChatStream({
        messages: [{content: "Hello", role: "user"}],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe("Mock response");
      const logs = await AIRequest.find({});
      expect(logs.length).toBe(1);
      expect(sink.traces.length).toBe(1);
    });
  });

  describe("TemperaturePresets", () => {
    it("should have correct values", () => {
      expect(TemperaturePresets.DETERMINISTIC).toBe(0);
      expect(TemperaturePresets.LOW).toBe(0.3);
      expect(TemperaturePresets.BALANCED).toBe(0.7);
      expect(TemperaturePresets.DEFAULT).toBe(1.0);
      expect(TemperaturePresets.HIGH).toBe(1.5);
      expect(TemperaturePresets.MAXIMUM).toBe(2.0);
    });
  });
});
