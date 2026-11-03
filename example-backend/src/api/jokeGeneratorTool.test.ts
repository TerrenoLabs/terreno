import {afterEach, describe, it, mock} from "bun:test";
import {
  AIService,
  createLocalObservabilityPlugin,
  LocalPromptStore,
  ObservabilityApp,
  resetObservabilityApp,
} from "@terreno/ai";
import type {LanguageModel, Tool} from "ai";
import {assert} from "chai";
import mongoose from "mongoose";
import {createJokeGeneratorTool} from "./ai";

const JOKE_V1_SYSTEM = "Registry comedian system prompt";

const createMockModel = () => ({
  doGenerate: mock(async (_options: unknown) => ({
    content: [{text: " A registry joke. ", type: "text" as const}],
    finishReason: "stop" as const,
    usage: {inputTokens: 5, outputTokens: 5},
  })),
  doStream: mock(async () => {
    throw new Error("not streamed");
  }),
  modelId: "mock-joke-model",
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

const runJoke = async (model: ReturnType<typeof createMockModel>): Promise<unknown> => {
  const jokeTool = createJokeGeneratorTool({
    aiService: new AIService({model: model as unknown as LanguageModel}),
    sessionId: "joke-session",
  }) as Tool<{style?: string; topic: string}, {joke: string}>;
  return jokeTool.execute?.({style: "pun", topic: "git"}, {messages: [], toolCallId: "call-1"});
};

const systemSent = (model: ReturnType<typeof createMockModel>): string => {
  const call = model.doGenerate.mock.calls[0]?.[0] as unknown as {
    prompt: Array<{content: unknown; role: string}>;
  };
  return String(call.prompt.find((message) => message.role === "system")?.content);
};

describe("generate_joke tool", () => {
  afterEach(() => {
    resetObservabilityApp();
  });

  it("uses the production joke-generator prompt and traces it", async () => {
    new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]});
    const promptStore = new LocalPromptStore();
    await promptStore.create({
      folder: "examples",
      name: "joke-generator",
      system: JOKE_V1_SYSTEM,
      template: "Tell me a {{style}} joke about: {{topic}}",
      type: "chat",
    });
    await promptStore.moveLabel("joke-generator", {label: "production", version: 1});
    const model = createMockModel();

    const result = await runJoke(model);

    assert.deepEqual(result, {joke: "A registry joke."});
    assert.equal(systemSent(model), JOKE_V1_SYSTEM);
    const [trace] = await mongoose.model("ObsTrace").find({sessionId: "joke-session"});
    assert.deepEqual(
      trace?.toObject().prompts.map((ref: {name: string}) => ref.name),
      ["joke-generator"]
    );
  });

  it("falls back to the built-in prompt when the registry has no joke-generator", async () => {
    new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]});
    const model = createMockModel();

    const result = await runJoke(model);

    assert.deepEqual(result, {joke: "A registry joke."});
    assert.match(systemSent(model), /witty comedian/);
  });
});
