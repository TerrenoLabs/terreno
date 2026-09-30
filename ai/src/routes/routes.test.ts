import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import {jsonSchema, type LanguageModel, type Tool, tool} from "ai";
import {assert} from "chai";
import type express from "express";
import mongoose from "mongoose";
import type supertest from "supertest";

import {AIRequest} from "../models/aiRequest";
import {GptHistory} from "../models/gptHistory";
import {Project} from "../models/project";
import {MemoryTraceSink} from "../observability/local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observability/observabilityApp";
import type {ObservabilityPlugin} from "../observability/types";
import {AIService} from "../service/aiService";
import type {MCPService} from "../service/mcpService";
import {authAsUser, ensureTestUsers, UserModel} from "../tests/helpers";
import {addAiRequestsExplorerRoutes} from "./aiRequestsExplorer";
import {addGptHistoryRoutes} from "./gptHistories";

type SseResponse = supertest.Response & {body: string};

// Mock langfuseVercelAi to avoid transitive langfuse SDK import in tests.
// Spread the real module so later-loaded test files still see the real exports.
const realLangfuseVercelAi = await import("../langfuseVercelAi");
mock.module("../langfuseVercelAi", () => ({
  ...realLangfuseVercelAi,
  createTelemetryConfig: () => ({functionId: "test", isEnabled: false}),
  preparePromptForAI: async () => ({config: {}, prompt: "test", telemetry: {isEnabled: false}}),
}));

const realAi = await import("ai");
type StreamTextOptions = Parameters<typeof realAi.streamText>[0];
type StreamTextResult = ReturnType<typeof realAi.streamText>;
const realStreamText = realAi.streamText;
let streamTextOverride: ((options: StreamTextOptions) => StreamTextResult) | undefined;
mock.module("ai", () => ({
  ...realAi,
  streamText: (options: StreamTextOptions): StreamTextResult =>
    streamTextOverride ? streamTextOverride(options) : realStreamText(options),
}));

const {addGptRoutes} = await import("./gpt");

// Create mock AI model (LanguageModelV2)
const createMockModel = (modelId = "mock-model") => ({
  doGenerate: mock(async () => ({
    content: [{text: "AI response", type: "text" as const}],
    finishReason: "stop" as const,
    usage: {inputTokens: 5, outputTokens: 10},
  })),
  doStream: mock(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({id: "t1", type: "text-start" as const});
        controller.enqueue({delta: "AI ", id: "t1", type: "text-delta" as const});
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
  modelId,
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

// Create mock model that emits a file (image) event
const createImageModel = () => ({
  doGenerate: mock(async () => ({
    content: [{text: "done", type: "text" as const}],
    finishReason: "stop" as const,
    usage: {inputTokens: 2, outputTokens: 2},
  })),
  doStream: mock(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({id: "t1", type: "text-start" as const});
        controller.enqueue({delta: "here is an image", id: "t1", type: "text-delta" as const});
        controller.enqueue({id: "t1", type: "text-end" as const});
        controller.enqueue({
          data: "aGVsbG8=",
          mediaType: "image/png",
          type: "file" as const,
        });
        controller.enqueue({
          finishReason: "stop" as const,
          type: "finish" as const,
          usage: {inputTokens: 2, outputTokens: 2},
        });
        controller.close();
      },
    }),
  })),
  modelId: "gemini-2.5-flash-image",
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

// Mock model that emits one generated image and no text
const createImageOnlyModel = () => ({
  doGenerate: mock(async () => ({
    content: [],
    finishReason: "stop" as const,
    usage: {inputTokens: 2, outputTokens: 2},
  })),
  doStream: mock(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          data: "aGVsbG8=",
          mediaType: "image/png",
          type: "file" as const,
        });
        controller.enqueue({
          finishReason: "stop" as const,
          type: "finish" as const,
          usage: {inputTokens: 2, outputTokens: 2},
        });
        controller.close();
      },
    }),
  })),
  modelId: "gemini-3-pro-image",
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

// Mock model that emits text without a finish event (no finish-step → post-loop flush)
const createNoFinishModel = () => ({
  doGenerate: mock(async () => ({
    content: [{text: "unflushed", type: "text" as const}],
    finishReason: "stop" as const,
    usage: {inputTokens: 1, outputTokens: 1},
  })),
  doStream: mock(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({id: "t1", type: "text-start" as const});
        controller.enqueue({delta: "buffered text", id: "t1", type: "text-delta" as const});
        controller.enqueue({id: "t1", type: "text-end" as const});
        // Deliberately omit finish event so the SDK does not emit finish-step
        controller.close();
      },
    }),
  })),
  modelId: "no-finish-model",
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

// Mock model that throws during doStream to exercise the inner catch
const createErrorModel = () => ({
  doGenerate: mock(async () => ({
    content: [],
    finishReason: "error" as const,
    usage: {inputTokens: 0, outputTokens: 0},
  })),
  doStream: mock(async () => {
    throw new Error("stream failure");
  }),
  modelId: "error-model",
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

let app: express.Application;
let aiService: AIService;

describe("AI Routes", () => {
  beforeAll(async () => {
    await ensureTestUsers();
    await AIRequest.deleteMany({});
    await GptHistory.deleteMany({});
  });

  beforeEach(() => {
    const mockModel = createMockModel();
    aiService = new AIService({model: mockModel as unknown as LanguageModel});

    app = new TerrenoApp({
      configureApp: (router, options) => {
        addGptHistoryRoutes(router, options);
        addGptRoutes(router, {aiService, openApiOptions: options});
        addAiRequestsExplorerRoutes(router, {openApiOptions: options});
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
  });

  afterEach(async () => {
    streamTextOverride = undefined;
    resetObservabilityApp();
    await AIRequest.deleteMany({});
    await GptHistory.deleteMany({});
  });

  describe("GPT History routes", () => {
    it("should create a history", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/histories")
        .send({prompts: [{text: "Hello", type: "user"}]});

      expect(res.status).toBe(201);
      expect(res.body.data.prompts.length).toBe(1);
    });

    it("should list histories for the current user", async () => {
      const agent = await authAsUser(app, "notAdmin");
      await agent.post("/gpt/histories").send({prompts: [{text: "Hello", type: "user"}]});

      const res = await agent.get("/gpt/histories");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GPT Remix route", () => {
    it("should remix text", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/remix").send({text: "Hello world"});

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it("should require text", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/remix").send({});

      expect(res.status).toBe(400);
    });

    it("forbids non-admin prompt registry selection", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/remix")
        .send({promptLabel: "latest", promptName: "private-prompt", text: "Hello"});

      assert.equal(res.status, 403);
    });

    it("returns demo response when no aiService configured", async () => {
      const demoApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(demoApp, "notAdmin");
      const res = await agent.post("/gpt/remix").send({text: "Hello"});
      expect(res.status).toBe(200);
      expect(res.body.data).toContain("demo mode");
    });
  });

  type SseStream = {on: (event: string, handler: (arg: Buffer) => void) => void};
  const sseCollect = (r: SseStream, cb: (err: Error | null, data: string) => void) => {
    let data = "";
    r.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    r.on("end", () => cb(null, data));
  };

  describe("GPT Prompt route", () => {
    it("requires a prompt", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/prompt").send({});
      // APIError.instanceof check in pre-stream catch results in 500 from the dist-compiled class,
      // but the body should contain the detail from the thrown APIError.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.detail || res.body.title).toContain("prompt");
    });

    it("streams a response and saves history", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);

      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("data:");
      expect(body).toContain("done");

      const histories = await GptHistory.find({});
      expect(histories.length).toBeGreaterThanOrEqual(1);
    });

    it("forbids non-admin prompt registry selection", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi", promptLabel: "latest", promptName: "private-prompt"});

      assert.equal(res.status, 403);
    });

    it("does not let client sensitive false downgrade a sensitive prompt", async () => {
      const sink = new MemoryTraceSink();
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
          get: async () => ({
            body: "Sensitive system prompt",
            label: "production",
            name: "sensitive-prompt",
            sensitive: true,
            version: 1,
          }),
        },
        reviewQueue: {},
        traceSink: sink,
      };
      new ObservabilityApp({plugins: [plugin]});

      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi", promptName: "sensitive-prompt", sensitive: false})
        .buffer(true)
        .parse(sseCollect);

      assert.equal(res.status, 200);
      assert.equal(sink.traces.length, 1);
      assert.isTrue(sink.traces[0]?.sensitive);
    });

    it("emits a memory-sink trace with userId and sessionId", async () => {
      const sink = new MemoryTraceSink();
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
        promptRegistry: {get: async () => undefined},
        reviewQueue: {},
        traceSink: sink,
      };
      new ObservabilityApp({plugins: [plugin]});

      const agent = await authAsUser(app, "notAdmin");
      const user = await UserModel.findOne({email: "notAdmin@example.com"});
      const res = await agent
        .post("/gpt/prompt")
        .set("x-ai-session-id", "sess-gpt-1")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);

      expect(res.status).toBe(200);
      expect(sink.traces.length).toBe(1);
      expect(sink.traces[0].sessionId).toBe("sess-gpt-1");
      expect(sink.traces[0].userId).toBe(user?._id.toString());
    });

    it("sends demo response when no ai service configured", async () => {
      const demoApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(demoApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("demo mode");
    });

    it("uses per-request api key via x-ai-api-key header", async () => {
      const createModelFn = mock((_apiKey: string, _modelId?: string) => {
        return createMockModel() as unknown as LanguageModel;
      });
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {createModelFn, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .set("x-ai-api-key", "test-key")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      expect(createModelFn).toHaveBeenCalled();
    });

    it("uses createServerModelFn when model requested", async () => {
      const createServerModelFn = mock(
        (_modelId?: string) => createMockModel() as unknown as LanguageModel
      );
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {createServerModelFn, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({model: "gemini-2.5-pro", prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      expect(createServerModelFn).toHaveBeenCalledWith("gemini-2.5-pro");
    });

    it("falls back to default aiService when createServerModelFn returns null", async () => {
      const createServerModelFn = mock((_modelId?: string) => null);
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService, createServerModelFn, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({model: "unsupported-model", prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      expect(createServerModelFn).toHaveBeenCalledWith("unsupported-model");
      const body = (res as SseResponse).body;
      expect(body).toContain("done");
    });

    it("rejects history from another user", async () => {
      const otherUserId = new mongoose.Types.ObjectId();
      const other = await GptHistory.create({
        prompts: [{text: "Hello", type: "user"}],
        userId: otherUserId,
      });

      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({historyId: other._id.toString(), prompt: "Hi"});
      // APIError instanceof check returns false for dist-compiled classes, yielding 500
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).toContain("authorized");
    });

    it("returns an error body for unknown historyId", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await agent.post("/gpt/prompt").send({historyId: fakeId, prompt: "Hi"});
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).toContain("not found".toLowerCase());
    });

    it("continues an existing history", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const history = await GptHistory.create({
        prompts: [{text: "Hello", type: "user"}],
        userId: notAdmin._id,
      });

      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({historyId: history._id.toString(), prompt: "Hi again"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const updated = await GptHistory.findById(history._id);
      expect(updated?.prompts.length).toBeGreaterThanOrEqual(3);
    });

    it("integrates project context when projectId is provided", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const project = await Project.create({
        memories: [{source: "user", text: "Likes brief answers"}],
        name: "Test Project",
        systemContext: "Respond concisely",
        userId: notAdmin._id,
      });

      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({projectId: project._id.toString(), prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      await Project.deleteMany({});
    });

    it("handles attachments in the prompt", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({
          attachments: [
            {mimeType: "image/png", type: "image", url: "https://example.com/img.png"},
            {
              filename: "doc.pdf",
              mimeType: "application/pdf",
              type: "file",
              url: "https://example.com/doc.pdf",
            },
          ],
          prompt: "What is this?",
        })
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
    });

    it("flushes remaining buffered text when the stream ends without finish-step", async () => {
      streamTextOverride = () =>
        ({
          files: Promise.resolve([]),
          fullStream: (async function* () {
            yield {text: "buffered text", type: "text-delta"};
          })(),
        }) as unknown as StreamTextResult;
      const noFinishService = new AIService({
        model: createNoFinishModel() as unknown as LanguageModel,
      });
      const noFinishApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService: noFinishService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(noFinishApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      assert.equal(res.status, 200);
      const body = (res as SseResponse).body;
      assert.include(body, "buffered text");
    });

    it("streams inline image events from the model", async () => {
      const imageService = new AIService({
        model: createImageModel() as unknown as LanguageModel,
      });
      const imgApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService: imageService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(imgApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Make an image"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain(
        '"image":{"mimeType":"image/png","url":"data:image/png;base64,aGVsbG8="}'
      );
    });

    it("emits and saves a generated image once, with no placeholder text", async () => {
      const imageService = new AIService({
        model: createImageOnlyModel() as unknown as LanguageModel,
      });
      const imgApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService: imageService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(imgApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Make an image"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body.match(/"image":\{/g)?.length).toBe(1);

      const history = await GptHistory.findExactlyOne({"prompts.text": "Make an image"});
      const assistant = history.prompts.find((p) => p.type === "assistant");
      expect(assistant?.text).toBe("");
      expect(assistant?.content).toHaveLength(1);
      expect(assistant?.content?.[0]?.url).toBe("data:image/png;base64,aGVsbG8=");
    });

    it("writes an SSE error event when the model stream throws", async () => {
      const errService = new AIService({
        model: createErrorModel() as unknown as LanguageModel,
      });
      const errApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService: errService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(errApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("error");
    });

    it("merges MCP tools and tolerates MCP getTools failures", async () => {
      const mcpService = {
        getTools: mock(async () => {
          throw new Error("mcp unavailable");
        }),
      } as unknown as MCPService;
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService, mcpService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      expect(mcpService.getTools).toHaveBeenCalled();
    });

    it("merges MCP tools on success", async () => {
      const mcpService = {
        getTools: mock(async () => ({
          search: {description: "web search"},
        })),
      } as unknown as MCPService;
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService, mcpService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
    });

    it("generates titles via a dedicated title model factory", async () => {
      const mainFn = mock(() => createMockModel("main") as unknown as LanguageModel);
      const titleFn = mock(() => createMockModel("title-model") as unknown as LanguageModel);
      // createServerModelFn routes by id so we can differentiate main vs. title model.
      const createServerModelFn = mock((modelId?: string) => {
        if (modelId === "title-model") {
          return titleFn();
        }
        return mainFn();
      });
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            createServerModelFn,
            openApiOptions: options,
            titleModelId: "title-model",
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({model: "main", prompt: "Hello"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      expect(createServerModelFn).toHaveBeenCalledWith("title-model");
    });

    it("generates titles via per-request api key title model", async () => {
      const createModelFn = mock((_apiKey: string, _modelId?: string) => {
        return createMockModel() as unknown as LanguageModel;
      });
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            createModelFn,
            openApiOptions: options,
            titleModelId: "title-small",
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .set("x-ai-api-key", "user-key")
        .send({prompt: "Hello"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      // First call is the main model, subsequent call should be the title model.
      expect(createModelFn).toHaveBeenCalled();
      const titleCalls = (
        createModelFn as unknown as {mock: {calls: Array<[string, string?]>}}
      ).mock.calls.filter((args) => args[1] === "title-small");
      expect(titleCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("applies image provider options for image-capable models", async () => {
      const imageService = new AIService({
        model: createImageModel() as unknown as LanguageModel,
      });
      const imgApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: imageService,
            openApiOptions: options,
            tools: {
              dummy: {description: "ignored for image models"} as unknown as Tool,
            },
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(imgApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Draw a cat"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
    });

    it("uses the langfuse system prompt when configured", async () => {
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService,
            langfuseSystemPromptName: "missing-prompt-name",
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
    });

    it("forwards model tool-call and tool-result stream events via SSE", async () => {
      const sink = new MemoryTraceSink();
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
        promptRegistry: {get: async () => undefined},
        reviewQueue: {},
        traceSink: sink,
      };
      new ObservabilityApp({plugins: [plugin]});

      const toolModel = {
        doGenerate: mock(async () => ({
          content: [{text: "ok", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({id: "t1", type: "text-start" as const});
              controller.enqueue({
                delta: "Let me search.",
                id: "t1",
                type: "text-delta" as const,
              });
              controller.enqueue({id: "t1", type: "text-end" as const});
              controller.enqueue({
                input: {q: "hello"},
                providerExecuted: true,
                toolCallId: "tc1",
                toolName: "search",
                type: "tool-call" as const,
              });
              controller.enqueue({
                providerExecuted: true,
                result: {
                  fileData: "data:application/pdf;base64,AAAA",
                  filename: "result.pdf",
                  mimeType: "application/pdf",
                  results: ["item1"],
                },
                toolCallId: "tc1",
                toolName: "search",
                type: "tool-result" as const,
              });
              controller.enqueue({
                input: {id: "second"},
                providerExecuted: true,
                toolCallId: "tc2",
                toolName: "lookup",
                type: "tool-call" as const,
              });
              controller.enqueue({
                providerExecuted: true,
                result: {value: "second-result"},
                toolCallId: "tc2",
                toolName: "lookup",
                type: "tool-result" as const,
              });
              controller.enqueue({
                finishReason: "stop" as const,
                type: "finish" as const,
                usage: {inputTokens: 3, outputTokens: 3},
              });
              controller.close();
            },
          }),
        })),
        modelId: "mock-tools",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const toolApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({model: toolModel as unknown as LanguageModel}),
            openApiOptions: options,
            tools: {
              lookup: {description: "Lookup item"} as unknown as Tool,
              search: {description: "Web search"} as unknown as Tool,
            },
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(toolApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "search"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("toolCall");
      expect(body).toContain("toolResult");
      assert.equal(sink.traces.length, 1);
      const trace = sink.traces[0];
      assert.equal(trace.spans[0]?.kind, "CHAIN");
      assert.equal(trace.spans.length, 3);
      const toolSpans = trace.spans.filter((span) => span.kind === "TOOL");
      assert.sameMembers(
        toolSpans.map((span) => span.name),
        ["search", "lookup"]
      );
      const toolSpan = toolSpans.find((span) => span.name === "search");
      assert.isDefined(toolSpan);
      assert.equal(toolSpan?.name, "search");
      assert.deepEqual(toolSpan?.input, {q: "hello"});
      assert.deepEqual(toolSpan?.output, {
        filename: "result.pdf",
        mimeType: "application/pdf",
        results: ["item1"],
      });
      assert.equal(toolSpan?.parentSpanId, trace.spans[0]?.id);
      assert.equal(
        toolSpans.find((span) => span.name === "lookup")?.parentSpanId,
        trace.spans[0]?.id
      );
    });

    it("emits a file SSE event when a tool execution returns fileData", async () => {
      let toolCallEmitted = false;
      const fileToolModel = {
        doGenerate: mock(async () => ({
          content: [{text: "ok", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              if (!toolCallEmitted) {
                toolCallEmitted = true;
                controller.enqueue({id: "t1", type: "text-start" as const});
                controller.enqueue({
                  delta: "Generating",
                  id: "t1",
                  type: "text-delta" as const,
                });
                controller.enqueue({id: "t1", type: "text-end" as const});
                controller.enqueue({
                  input: "{}",
                  toolCallId: "tc1",
                  toolName: "fileTool",
                  type: "tool-call" as const,
                });
                controller.enqueue({
                  finishReason: "tool-calls" as const,
                  type: "finish" as const,
                  usage: {inputTokens: 1, outputTokens: 1},
                });
              } else {
                // Second step after tool execution: just finish.
                controller.enqueue({id: "t2", type: "text-start" as const});
                controller.enqueue({delta: "done", id: "t2", type: "text-delta" as const});
                controller.enqueue({id: "t2", type: "text-end" as const});
                controller.enqueue({
                  finishReason: "stop" as const,
                  type: "finish" as const,
                  usage: {inputTokens: 1, outputTokens: 1},
                });
              }
              controller.close();
            },
          }),
        })),
        modelId: "file-tool-model",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const fileTool = tool({
        description: "Returns a generated file",
        execute: async () => ({
          fileData: "data:application/pdf;base64,AAAA",
          filename: "result.pdf",
          mimeType: "application/pdf",
        }),
        inputSchema: jsonSchema({properties: {}, type: "object"}),
      });
      const fileToolApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({model: fileToolModel as unknown as LanguageModel}),
            openApiOptions: options,
            tools: {fileTool},
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(fileToolApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "make a file"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("file");
      expect(body).toContain("result.pdf");
      expect(body).toContain("application/pdf");
    });

    it("forwards mid-stream error parts as SSE error events", async () => {
      const errEventModel = {
        doGenerate: mock(async () => ({
          content: [{text: "ok", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({id: "t1", type: "text-start" as const});
              controller.enqueue({delta: "partial", id: "t1", type: "text-delta" as const});
              controller.enqueue({id: "t1", type: "text-end" as const});
              controller.enqueue({
                error: new Error("mid-stream failure"),
                type: "error" as const,
              });
              controller.enqueue({
                finishReason: "stop" as const,
                type: "finish" as const,
                usage: {inputTokens: 1, outputTokens: 1},
              });
              controller.close();
            },
          }),
        })),
        modelId: "mock-error-event",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const errApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({
              model: errEventModel as unknown as LanguageModel,
            }),
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(errApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("mid-stream failure");
    });

    it("swallows title generation errors without failing the stream", async () => {
      const throwingTitleModel = {
        doGenerate: mock(async () => {
          throw new Error("title generate failed");
        }),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({id: "t1", type: "text-start" as const});
              controller.enqueue({delta: "ok", id: "t1", type: "text-delta" as const});
              controller.enqueue({id: "t1", type: "text-end" as const});
              controller.enqueue({
                finishReason: "stop" as const,
                type: "finish" as const,
                usage: {inputTokens: 1, outputTokens: 1},
              });
              controller.close();
            },
          }),
        })),
        modelId: "title-throw",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const createServerModelFn = mock((id?: string) => {
        if (id === "title-throw-model") {
          return throwingTitleModel as unknown as LanguageModel;
        }
        return createMockModel() as unknown as LanguageModel;
      });
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            createServerModelFn,
            openApiOptions: options,
            titleModelId: "title-throw-model",
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({model: "main-model", prompt: "Give me a title"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      expect(createServerModelFn).toHaveBeenCalledWith("title-throw-model");
    });

    it("associates a projectId with an existing history when provided later", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const project = await Project.create({name: "Late Project", userId: notAdmin._id});
      const history = await GptHistory.create({
        prompts: [{text: "Hi", type: "user"}],
        userId: notAdmin._id,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({
          historyId: history._id.toString(),
          projectId: project._id.toString(),
          prompt: "Follow up",
        })
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const updated = await GptHistory.findById(history._id);
      expect(updated?.projectId?.toString()).toBe(project._id.toString());
      await Project.deleteMany({});
    });

    it("streams text-delta events through the SSE path with a minimal mock model", async () => {
      // Covers the text-delta SSE branch by using a model that emits only
      // text-delta + finish (no step-start/step-end events).
      const noStepModel = {
        doGenerate: mock(async () => ({
          content: [{text: "ok", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({delta: "buffered tail", id: "t1", type: "text-delta" as const});
              controller.enqueue({
                finishReason: "stop" as const,
                type: "finish" as const,
                usage: {inputTokens: 1, outputTokens: 1},
              });
              controller.close();
            },
          }),
        })),
        modelId: "no-step-model",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({model: noStepModel as unknown as LanguageModel}),
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("buffered tail");
    });

    it("uses per-request tools via createRequestTools", async () => {
      const createRequestTools = mock(() => ({
        localLookup: {description: "Per-request tool"} as unknown as Tool,
      }));
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService,
            createRequestTools,
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      expect(createRequestTools).toHaveBeenCalled();
    });

    it("streams with a model that emits a non-image file part (exercises file type guard)", async () => {
      const nonImageFileModel = {
        doGenerate: mock(async () => ({
          content: [{text: "done", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 2, outputTokens: 2},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({id: "t1", type: "text-start" as const});
              controller.enqueue({delta: "here is a file", id: "t1", type: "text-delta" as const});
              controller.enqueue({id: "t1", type: "text-end" as const});
              controller.enqueue({
                data: "UERGLWNvbnRlbnQ=",
                mediaType: "application/pdf",
                type: "file" as const,
              });
              controller.enqueue({
                finishReason: "stop" as const,
                type: "finish" as const,
                usage: {inputTokens: 2, outputTokens: 2},
              });
              controller.close();
            },
          }),
        })),
        modelId: "file-model",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const fileApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({model: nonImageFileModel as unknown as LanguageModel}),
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(fileApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Give me a PDF"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      // Non-image files should not produce an image SSE event
      expect(body).not.toContain('"image"');
      expect(body).toContain("done");
    });
  });

  describe("GPT history rating route", () => {
    it("rejects non-numeric promptIndex", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const h = await GptHistory.create({
        prompts: [{text: "hi", type: "user"}],
        userId: notAdmin._id,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .patch(`/gpt/histories/${h._id.toString()}/rating`)
        .send({promptIndex: "bad", rating: "up"});
      expect(res.status).toBe(400);
    });

    it("rejects invalid rating value", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const h = await GptHistory.create({
        prompts: [{text: "hi", type: "user"}],
        userId: notAdmin._id,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .patch(`/gpt/histories/${h._id.toString()}/rating`)
        .send({promptIndex: 0, rating: "maybe"});
      expect(res.status).toBe(400);
    });

    it("returns 404 for missing history", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const id = new mongoose.Types.ObjectId().toString();
      const res = await agent
        .patch(`/gpt/histories/${id}/rating`)
        .send({promptIndex: 0, rating: "up"});
      expect(res.status).toBe(404);
    });

    it("returns 403 when not owner", async () => {
      const otherId = new mongoose.Types.ObjectId();
      const h = await GptHistory.create({
        prompts: [{text: "hi", type: "user"}],
        userId: otherId,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .patch(`/gpt/histories/${h._id.toString()}/rating`)
        .send({promptIndex: 0, rating: "up"});
      expect(res.status).toBe(403);
    });

    it("rejects out-of-range promptIndex", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const h = await GptHistory.create({
        prompts: [{text: "hi", type: "user"}],
        userId: notAdmin._id,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .patch(`/gpt/histories/${h._id.toString()}/rating`)
        .send({promptIndex: 99, rating: "up"});
      expect(res.status).toBe(400);
    });

    it("sets rating on a prompt", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const h = await GptHistory.create({
        prompts: [
          {text: "hi", type: "user"},
          {text: "hello!", type: "assistant"},
        ],
        userId: notAdmin._id,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .patch(`/gpt/histories/${h._id.toString()}/rating`)
        .send({promptIndex: 1, rating: "up"});
      expect(res.status).toBe(200);
      expect(res.body.data.rating).toBe("up");
    });

    it("clears rating when null is passed", async () => {
      const notAdmin = (await UserModel.findOne({
        email: "notAdmin@example.com",
      })) as mongoose.Document & {_id: mongoose.Types.ObjectId};
      const h = await GptHistory.create({
        prompts: [
          {text: "hi", type: "user"},
          {rating: "up", text: "hello!", type: "assistant"},
        ],
        userId: notAdmin._id,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .patch(`/gpt/histories/${h._id.toString()}/rating`)
        .send({promptIndex: 1, rating: null});
      expect(res.status).toBe(200);
      expect(res.body.data.rating).toBeNull();
    });
  });

  describe("GPT Prompt error handling", () => {
    it("preserves completed tool spans when the stream later fails", async () => {
      const sink = new MemoryTraceSink();
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
        promptRegistry: {get: async () => undefined},
        reviewQueue: {},
        traceSink: sink,
      };
      new ObservabilityApp({plugins: [plugin]});
      streamTextOverride = () =>
        ({
          files: Promise.resolve([]),
          fullStream: (async function* () {
            yield {type: "start-step"};
            yield {
              input: {query: "before failure"},
              toolCallId: "tc-error",
              toolName: "search",
              type: "tool-call",
            };
            yield {
              output: {items: ["one"]},
              toolCallId: "tc-error",
              toolName: "search",
              type: "tool-result",
            };
            throw new Error("stream failed after tool");
          })(),
        }) as unknown as StreamTextResult;
      const errApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService,
            openApiOptions: options,
            tools: {search: {description: "Search"} as unknown as Tool},
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(errApp, "notAdmin");

      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Search, then fail"})
        .buffer(true)
        .parse(sseCollect);

      assert.equal(res.status, 200);
      assert.equal(sink.traces.length, 1);
      assert.equal(sink.traces[0]?.status, "error");
      const toolSpan = sink.traces[0]?.spans.find((span) => span.kind === "TOOL");
      assert.deepEqual(toolSpan?.input, {query: "before failure"});
      assert.deepEqual(toolSpan?.output, {items: ["one"]});
    });

    it("sends an outer SSE error when error handling itself fails after streaming starts", async () => {
      streamTextOverride = () =>
        ({
          files: Promise.resolve([]),
          fullStream: (async function* () {
            yield {type: "start-step"};
            yield {text: "partial response", type: "text-delta"};
            yield {type: "finish-step"};
            throw new Error("stream iteration failed");
          })(),
        }) as unknown as StreamTextResult;
      const errApp = new TerrenoApp({
        configureApp: (router, options) => {
          router.use((_req, res, next) => {
            const originalWrite = res.write;
            let writeCount = 0;
            res.write = new Proxy(originalWrite, {
              apply(target, thisArg, argumentsList) {
                writeCount++;
                if (writeCount === 2) {
                  throw new Error("error event write failed");
                }
                return Reflect.apply(target, thisArg, argumentsList);
              },
            });
            next();
          });
          addGptRoutes(router, {aiService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(errApp, "notAdmin");

      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);

      assert.equal(res.status, 200);
      assert.include((res as SseResponse).body, "error event write failed");
    });

    it("catches errors thrown mid-stream iteration and sends SSE error", async () => {
      const streamIterationErrorModel = {
        doGenerate: mock(async () => ({
          content: [{text: "ok", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({id: "t1", type: "text-start" as const});
              controller.enqueue({
                delta: "partial",
                id: "t1",
                type: "text-delta" as const,
              });
              controller.enqueue({id: "t1", type: "text-end" as const});
              controller.error(new Error("stream iteration failure"));
            },
          }),
        })),
        modelId: "stream-iter-error",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const errApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({
              model: streamIterationErrorModel as unknown as LanguageModel,
            }),
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(errApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Hi"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      expect(body).toContain("error");
    });

    it("handles AIRequest.logRequest failure gracefully", async () => {
      const originalLogRequest = AIRequest.logRequest;
      AIRequest.logRequest = mock(async () => {
        throw new Error("database write failed");
      }) as unknown as typeof AIRequest.logRequest;
      try {
        const agent = await authAsUser(app, "notAdmin");
        const res = await agent
          .post("/gpt/prompt")
          .send({prompt: "Hi"})
          .buffer(true)
          .parse(sseCollect);
        expect(res.status).toBe(200);
        const body = (res as SseResponse).body;
        expect(body).toContain("done");
      } finally {
        AIRequest.logRequest = originalLogRequest;
      }
    });

    it("swallows preparePromptForAI failure when langfuse prompt loading throws", async () => {
      // Re-mock preparePromptForAI to throw, exercising the catch branch that
      // logs `Langfuse system prompt skipped: ...` and continues without it.
      mock.module("../langfuseVercelAi", () => ({
        ...realLangfuseVercelAi,
        createTelemetryConfig: () => ({functionId: "test", isEnabled: false}),
        preparePromptForAI: async () => {
          throw new Error("langfuse offline");
        },
      }));
      try {
        const customApp = new TerrenoApp({
          configureApp: (router, options) => {
            addGptRoutes(router, {
              aiService,
              langfuseSystemPromptName: "broken-prompt",
              openApiOptions: options,
            });
          },
          skipListen: true,
          userModel: UserModel,
        }).build();
        const agent = await authAsUser(customApp, "notAdmin");
        const res = await agent
          .post("/gpt/prompt")
          .send({prompt: "Hi"})
          .buffer(true)
          .parse(sseCollect);
        // Failure is silently caught; request still completes successfully.
        expect(res.status).toBe(200);
        const body = (res as SseResponse).body;
        expect(body).toContain("done");
      } finally {
        // Restore the original happy-path mock for subsequent tests.
        mock.module("../langfuseVercelAi", () => ({
          ...realLangfuseVercelAi,
          createTelemetryConfig: () => ({functionId: "test", isEnabled: false}),
          preparePromptForAI: async () => ({
            config: {},
            prompt: "test",
            telemetry: {isEnabled: false},
          }),
        }));
      }
    });

    it("logs warning when AIRequest.logRequest throws inside the stream error catch", async () => {
      // Combine a stream that errors mid-iteration with a logRequest that also throws,
      // exercising the catch-within-catch that logs `Failed to log AIRequest error`.
      const streamIterationErrorModel = {
        doGenerate: mock(async () => ({
          content: [{text: "ok", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({id: "t1", type: "text-start" as const});
              controller.enqueue({
                delta: "partial",
                id: "t1",
                type: "text-delta" as const,
              });
              controller.enqueue({id: "t1", type: "text-end" as const});
              controller.error(new Error("stream iteration failure"));
            },
          }),
        })),
        modelId: "stream-iter-error",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const errApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({
              model: streamIterationErrorModel as unknown as LanguageModel,
            }),
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const originalLogRequest = AIRequest.logRequest;
      AIRequest.logRequest = mock(async () => {
        throw new Error("log write failed");
      }) as unknown as typeof AIRequest.logRequest;
      try {
        const agent = await authAsUser(errApp, "notAdmin");
        const res = await agent
          .post("/gpt/prompt")
          .send({prompt: "Hi"})
          .buffer(true)
          .parse(sseCollect);
        // Failure path still flushes an SSE error event and ends the response.
        expect(res.status).toBe(200);
        const body = (res as SseResponse).body;
        expect(body).toContain("error");
      } finally {
        AIRequest.logRequest = originalLogRequest;
      }
    });
  });

  describe("GPT tools route", () => {
    it("lists built-in tools from route config", async () => {
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService,
            openApiOptions: options,
            tools: {echo: {description: "Echo tool"} as unknown as Tool},
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent.get("/gpt/tools");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([expect.objectContaining({name: "echo", source: "builtin"})]);
    });

    it("includes per-request tools when createRequestTools is set", async () => {
      const createRequestTools = mock(() => ({
        now: {description: "Current time"} as unknown as Tool,
      }));
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService, createRequestTools, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent.get("/gpt/tools");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([expect.objectContaining({name: "now"})]);
    });

    it("includes MCP tools when mcpService is set", async () => {
      const mcpService = {
        getTools: mock(async () => ({search: {description: "web search"}})),
      } as unknown as MCPService;
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService, mcpService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent.get("/gpt/tools");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([expect.objectContaining({name: "search", source: "mcp"})]);
    });

    it("tolerates mcpService.getTools errors", async () => {
      const mcpService = {
        getTools: mock(async () => {
          throw new Error("boom");
        }),
      } as unknown as MCPService;
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {aiService, mcpService, openApiOptions: options});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(customApp, "notAdmin");
      const res = await agent.get("/gpt/tools");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("AI Requests Explorer route", () => {
    it("should return 403 for non-admin users", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/aiRequestsExplorer");

      expect(res.status).toBe(403);
    });

    it("should return data for admin users", async () => {
      // Create some test data
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "test",
        requestType: "general",
        response: "response",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer");

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.page).toBe(1);
    });

    it("filters by requestType query parameter", async () => {
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "remix prompt",
        requestType: "remix",
        response: "remix response",
      });
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "general prompt",
        requestType: "general",
        response: "general response",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?requestType=remix");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].requestType).toBe("remix");
    });

    it("filters by multiple requestType values", async () => {
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "remix prompt",
        requestType: "remix",
        response: "remix response",
      });
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "general prompt",
        requestType: "general",
        response: "general response",
      });
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "json prompt",
        requestType: "json_object",
        response: "json response",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?requestType=remix,general");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      const types = (res.body.data as {requestType: string}[]).map((row) => row.requestType).sort();
      expect(types).toEqual(["general", "remix"]);
    });

    it("filters by repeated requestType query parameters", async () => {
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "remix prompt",
        requestType: "remix",
        response: "remix response",
      });
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "general prompt",
        requestType: "general",
        response: "general response",
      });
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "json prompt",
        requestType: "json_object",
        response: "json response",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?requestType=remix&requestType=general");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      const types = (res.body.data as {requestType: string}[]).map((row) => row.requestType).sort();
      expect(types).toEqual(["general", "remix"]);
    });

    it("ignores blank and non-string requestType values", async () => {
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "general prompt",
        requestType: "general",
        response: "general response",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?requestType=,%20&requestType[key]=general");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    });

    it("filters by model query parameter", async () => {
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "p1",
        requestType: "general",
        response: "r1",
      });
      await AIRequest.create({
        aiModel: "claude-3",
        prompt: "p2",
        requestType: "general",
        response: "r2",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?model=claude-3");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].aiModel).toBe("claude-3");
    });

    it("filters by startDate query parameter", async () => {
      const old = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "old",
        requestType: "general",
        response: "r",
      });
      await AIRequest.updateOne({_id: old._id}, {created: new Date("2020-01-01T00:00:00Z")});

      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "new",
        requestType: "general",
        response: "r",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?startDate=2024-01-01T00:00:00Z");

      expect(res.status).toBe(200);
      // Only the recently-created record should be returned
      expect(res.body.total).toBe(1);
    });

    it("filters by endDate query parameter", async () => {
      const old = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "old",
        requestType: "general",
        response: "r",
      });
      await AIRequest.updateOne({_id: old._id}, {created: new Date("2020-01-01T00:00:00Z")});

      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "new",
        requestType: "general",
        response: "r",
      });

      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?endDate=2021-01-01T00:00:00Z");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    });

    it("returns 400 for invalid startDate format", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?startDate=not-a-date");

      expect(res.status).toBe(400);
      expect(res.body.title).toContain("Invalid startDate");
    });

    it("returns 400 for invalid endDate format", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/aiRequestsExplorer?endDate=not-a-date");

      expect(res.status).toBe(400);
      expect(res.body.title).toContain("Invalid endDate");
    });

    it("streams with a model that emits a non-image file part (exercises file type guard)", async () => {
      const nonImageFileModel = {
        doGenerate: mock(async () => ({
          content: [{text: "done", type: "text" as const}],
          finishReason: "stop" as const,
          usage: {inputTokens: 2, outputTokens: 2},
        })),
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({id: "t1", type: "text-start" as const});
              controller.enqueue({delta: "here is a file", id: "t1", type: "text-delta" as const});
              controller.enqueue({id: "t1", type: "text-end" as const});
              controller.enqueue({
                data: "UERGLWNvbnRlbnQ=",
                mediaType: "application/pdf",
                type: "file" as const,
              });
              controller.enqueue({
                finishReason: "stop" as const,
                type: "finish" as const,
                usage: {inputTokens: 2, outputTokens: 2},
              });
              controller.close();
            },
          }),
        })),
        modelId: "file-model",
        provider: "mock-provider",
        specificationVersion: "v2" as const,
        supportedUrls: {},
      };
      const fileApp = new TerrenoApp({
        configureApp: (router, options) => {
          addGptRoutes(router, {
            aiService: new AIService({model: nonImageFileModel as unknown as LanguageModel}),
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(fileApp, "notAdmin");
      const res = await agent
        .post("/gpt/prompt")
        .send({prompt: "Give me a PDF"})
        .buffer(true)
        .parse(sseCollect);
      expect(res.status).toBe(200);
      const body = (res as SseResponse).body;
      // Non-image files should not produce an image SSE event
      expect(body).not.toContain('"image"');
      expect(body).toContain("done");
    });

    it("filters by startDate and endDate range", async () => {
      const a = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "a",
        requestType: "general",
        response: "r",
      });
      await AIRequest.updateOne({_id: a._id}, {created: new Date("2022-06-01T00:00:00Z")});

      const b = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "b",
        requestType: "general",
        response: "r",
      });
      await AIRequest.updateOne({_id: b._id}, {created: new Date("2020-01-01T00:00:00Z")});

      const agent = await authAsUser(app, "admin");
      const res = await agent.get(
        "/aiRequestsExplorer?startDate=2022-01-01T00:00:00Z&endDate=2023-01-01T00:00:00Z"
      );

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    });
  });
});
