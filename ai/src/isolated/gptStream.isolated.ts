import {afterAll, beforeAll, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type {LanguageModel} from "ai";
import type express from "express";

import {GptHistory} from "../models/gptHistory";
import {authAsUser, ensureTestUsers, UserModel} from "../tests/helpers";

type StreamPart = {type: string; [key: string]: unknown};

// The parts emitted by the mocked `streamText` fullStream. Kept module-level so
// individual tests can tailor the stream before issuing a request.
let streamParts: StreamPart[] = [];
let streamFiles: Array<{base64: string; mediaType: string}> = [];

// Mock langfuseVercelAi to avoid transitive langfuse SDK imports.
const realLangfuseVercelAi = await import("../langfuseVercelAi");
mock.module("../langfuseVercelAi", () => ({
  ...realLangfuseVercelAi,
  createTelemetryConfig: () => ({functionId: "test", isEnabled: false}),
  preparePromptForAI: async () => ({config: {}, prompt: "test", telemetry: {isEnabled: false}}),
}));

// Mock the AI SDK so we control exactly which fullStream parts the GPT prompt
// handler iterates over. All other exports are preserved so AIService and the
// route helpers keep working.
const realAi = await import("ai");
mock.module("ai", () => ({
  ...realAi,
  streamText: () => ({
    files: Promise.resolve(streamFiles),
    fullStream: (async function* fullStream(): AsyncGenerator<StreamPart> {
      for (const part of streamParts) {
        yield part;
      }
    })(),
  }),
}));

const {addGptRoutes} = await import("../routes/gpt");
const {AIService} = await import("../service/aiService");

const createMockModel = () => ({
  doGenerate: mock(async () => ({
    content: [{text: "Mock Title", type: "text" as const}],
    finishReason: "stop" as const,
    usage: {inputTokens: 1, outputTokens: 1},
  })),
  doStream: mock(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          finishReason: "stop" as const,
          type: "finish" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        });
        controller.close();
      },
    }),
  })),
  modelId: "mock-model",
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

type SseStream = {on: (event: string, handler: (arg: Buffer) => void) => void};
const sseCollect = (r: SseStream, cb: (err: Error | null, data: string) => void): void => {
  let data = "";
  r.on("data", (chunk: Buffer) => {
    data += chunk.toString();
  });
  r.on("end", () => cb(null, data));
};

describe("GPT prompt streaming edge cases", () => {
  let app: express.Application;

  beforeAll(async () => {
    await ensureTestUsers();
    await GptHistory.collection.deleteMany({});
    const aiService = new AIService({
      model: createMockModel() as unknown as LanguageModel,
    });
    app = new TerrenoApp({
      configureApp: (router, options) => {
        addGptRoutes(router, {aiService, openApiOptions: options});
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
  });

  afterAll(async () => {
    await GptHistory.collection.deleteMany({});
  });

  it("emits an inline image and flushes buffered text with no finish-step", async () => {
    // A text-delta with no start-step/finish-step forces the post-loop flush,
    // and a file part with an image media type exercises the inline image path.
    streamParts = [
      {text: "Hello world", type: "text-delta"},
      {file: {base64: "aGVsbG8=", mediaType: "image/png"}, type: "file"},
    ];
    streamFiles = [];

    const agent = await authAsUser(app, "notAdmin");
    const res = await agent
      .post("/gpt/prompt")
      .send({prompt: "Draw something"})
      .buffer(true)
      .parse(sseCollect as never);

    expect(res.status).toBe(200);
    const body = (res as unknown as {body: string}).body;
    expect(body).toContain("Hello world");
    expect(body).toContain("image/png");
    expect(body).toContain("done");
  });

  it("ignores non-image inline file parts", async () => {
    // A non-image media type should skip the inline image branch entirely.
    streamParts = [
      {text: "Just text", type: "text-delta"},
      {file: {base64: "AAAA", mediaType: "application/pdf"}, type: "file"},
    ];
    streamFiles = [];

    const agent = await authAsUser(app, "notAdmin");
    const res = await agent
      .post("/gpt/prompt")
      .send({prompt: "No image"})
      .buffer(true)
      .parse(sseCollect as never);

    expect(res.status).toBe(200);
    const body = (res as unknown as {body: string}).body;
    expect(body).toContain("Just text");
    expect(body).not.toContain("application/pdf");
  });
});
