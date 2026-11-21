import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {APIError, logger} from "@terreno/api";
import {jsonSchema, type LanguageModel} from "ai";
import mongoose from "mongoose";

import {createTraceId} from "../index";
import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import {ObservabilityApp, resetObservabilityApp} from "../observability/observabilityApp";
import {AIService} from "./aiService";

const createMockModel = (responseText = "Mock response") => ({
  doGenerate: mock(async (_options: unknown) => ({
    content: [{text: responseText, type: "text" as const}],
    finishReason: "stop" as const,
    usage: {inputTokens: 5, outputTokens: 10},
  })),
  doStream: mock(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({id: "t1", type: "text-start" as const});
        controller.enqueue({delta: responseText, id: "t1", type: "text-delta" as const});
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
});

const drain = async (stream: AsyncGenerator<string>): Promise<string> => {
  let out = "";
  for await (const chunk of stream) {
    out += chunk;
  }
  return out;
};

const expectBadTraceId = async (run: () => Promise<unknown>): Promise<void> => {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(APIError);
  expect((caught as APIError).status).toBe(400);
  expect((caught as APIError).title).toBe("traceId must be an object id");
};

describe("AIService caller-supplied trace ids", () => {
  const ObsTrace = (): ReturnType<typeof registerObsTrace> => registerObsTrace();

  beforeEach(async () => {
    new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]});
    await ObsTrace().deleteMany({});
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  it("createTraceId returns a 24-character hex string, unique per call", () => {
    const first = createTraceId();
    expect(first).toMatch(/^[0-9a-f]{24}$/);
    expect(createTraceId()).not.toBe(first);
  });

  it("generateText writes the ObsTrace under the given traceId with that userId", async () => {
    const service = new AIService({model: createMockModel("Hello") as unknown as LanguageModel});
    const traceId = createTraceId();
    const userId = new mongoose.Types.ObjectId();

    const text = await service.generateText({prompt: "hi", traceId, userId});

    expect(text).toBe("Hello");
    const trace = await ObsTrace().findById(traceId);
    expect(trace).not.toBeNull();
    expect(String(trace?.userId)).toBe(userId.toString());
  });

  it("generateText without a traceId still writes a trace with a generated _id", async () => {
    const service = new AIService({model: createMockModel() as unknown as LanguageModel});

    await service.generateText({prompt: "hi"});

    const traces = await ObsTrace().find({});
    expect(traces.length).toBe(1);
    expect(String(traces[0]?._id)).toMatch(/^[0-9a-f]{24}$/);
  });

  it("rejects a non-ObjectId traceId with 400 before calling the model", async () => {
    const model = createMockModel();
    const service = new AIService({model: model as unknown as LanguageModel});

    await expectBadTraceId(() => service.generateText({prompt: "hi", traceId: "abc"}));

    expect(model.doGenerate.mock.calls.length).toBe(0);
    expect(await ObsTrace().countDocuments({})).toBe(0);
  });

  it("rejects an invalid traceId on streaming methods before calling the model", async () => {
    const model = createMockModel();
    const service = new AIService({model: model as unknown as LanguageModel});

    await expectBadTraceId(() => drain(service.generateTextStream({prompt: "hi", traceId: "abc"})));
    await expectBadTraceId(() =>
      drain(
        service.generateChatStream({
          messages: [{content: "hi", role: "user"}],
          traceId: "abc",
        })
      )
    );

    expect(model.doStream.mock.calls.length).toBe(0);
  });

  it("rejects a 24-char non-hex traceId with 400", async () => {
    const model = createMockModel();
    const service = new AIService({model: model as unknown as LanguageModel});

    await expectBadTraceId(() => service.generateText({prompt: "hi", traceId: "z".repeat(24)}));

    expect(model.doGenerate.mock.calls.length).toBe(0);
  });

  it("a duplicate traceId returns its text, keeps one ObsTrace, and logs one error", async () => {
    const service = new AIService({model: createMockModel("Again") as unknown as LanguageModel});
    const traceId = createTraceId();
    await service.generateText({prompt: "first", traceId});
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);

    try {
      const text = await service.generateText({prompt: "second", traceId});

      expect(text).toBe("Again");
      expect(await ObsTrace().countDocuments({})).toBe(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("skipTrace with a traceId writes no trace and does not throw", async () => {
    const service = new AIService({model: createMockModel("Quiet") as unknown as LanguageModel});

    const text = await service.generateText({
      prompt: "hi",
      skipTrace: true,
      traceId: createTraceId(),
    });

    expect(text).toBe("Quiet");
    expect(await ObsTrace().countDocuments({})).toBe(0);
  });

  it("resolveGenerateObservability({traceId}) then recordGenerate writes that _id", async () => {
    const service = new AIService({model: createMockModel() as unknown as LanguageModel});
    const traceId = createTraceId();
    const observability = await service.resolveGenerateObservability({traceId});

    await service.recordGenerate({
      observability,
      prompt: "p",
      requestType: "general",
      response: "r",
      responseTime: 5,
      startTime: Date.now() - 5,
    });

    expect(await ObsTrace().findById(traceId)).not.toBeNull();
  });

  it("resolveGenerateObservability rejects an invalid traceId with 400", async () => {
    const service = new AIService({model: createMockModel() as unknown as LanguageModel});

    await expectBadTraceId(() => service.resolveGenerateObservability({traceId: "abc"}));
  });

  describe("every generate method passes traceId through", () => {
    const cases: Array<{
      name: string;
      run: (service: AIService, traceId: string) => Promise<unknown>;
    }> = [
      {
        name: "generateTextStream",
        run: (service, traceId) => drain(service.generateTextStream({prompt: "hi", traceId})),
      },
      {
        name: "generateChatStream",
        run: (service, traceId) =>
          drain(service.generateChatStream({messages: [{content: "hi", role: "user"}], traceId})),
      },
      {
        name: "generateSummary",
        run: (service, traceId) => service.generateSummary({text: "long text", traceId}),
      },
      {
        name: "generateRemix",
        run: (service, traceId) => service.generateRemix({text: "some text", traceId}),
      },
      {
        name: "translateText",
        run: (service, traceId) =>
          service.translateText({targetLanguage: "French", text: "hello", traceId}),
      },
      {
        name: "generateJsonObject",
        run: (service, traceId) =>
          service.generateJsonObject({
            prompt: "give json",
            schema: jsonSchema<{a: number}>({
              properties: {a: {type: "number"}},
              required: ["a"],
              type: "object",
            }),
            traceId,
          }),
      },
    ];

    for (const {name, run} of cases) {
      it(`${name} writes the ObsTrace under the given traceId`, async () => {
        const service = new AIService({
          model: createMockModel('{"a":1}') as unknown as LanguageModel,
        });
        const traceId = createTraceId();

        await run(service, traceId);

        expect(await ObsTrace().findById(traceId)).not.toBeNull();
      });
    }
  });
});
