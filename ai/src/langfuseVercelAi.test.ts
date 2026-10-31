import {beforeEach, describe, expect, it, mock} from "bun:test";

import {LangfuseCache} from "./langfuseCache";
import {getLangfuseClient, initLangfuseClient} from "./langfuseClient";
import {createTelemetryConfig, preparePromptForAI} from "./langfuseVercelAi";
import type {FakeLangfusePrompt} from "./tests/fakeLangfusePrompt";

const mockPromptGet = mock(
  async (_name: string, _options?: Record<string, unknown>): Promise<FakeLangfusePrompt> => ({
    config: {temperature: 0.5},
    labels: [],
    name: "welcome",
    prompt: "Hi {{name}}",
    tags: [],
    type: "text" as const,
    version: 3,
  })
);

describe("langfuseVercelAi", () => {
  beforeEach(async () => {
    mockPromptGet.mockClear();
    await LangfuseCache.deleteMany({});
    // Re-init the (fake) langfuse client and wire the prompt.get mock so the
    // real `getPrompt`/`compilePrompt` from `./langfusePrompts` runs against
    // a customizable response without network access.
    initLangfuseClient({publicKey: "pk-test", secretKey: "sk-test"});
    (getLangfuseClient() as unknown as {prompt: {get: typeof mockPromptGet}}).prompt.get =
      mockPromptGet;
  });

  describe("preparePromptForAI", () => {
    it("returns a compiled text prompt with telemetry", async () => {
      const result = await preparePromptForAI({
        promptName: "welcome",
        userId: "user-1",
        variables: {name: "Sam"},
      });
      expect(result.prompt).toBe("Hi Sam");
      expect(result.telemetry.functionId).toBe("prompt:welcome");
      expect(result.telemetry.metadata?.userId).toBe("user-1");
      expect(result.telemetry.metadata?.langfusePromptVersion).toBe(3);
    });

    it("omits userId metadata when not provided", async () => {
      const result = await preparePromptForAI({promptName: "welcome"});
      expect(result.telemetry.metadata?.userId).toBeUndefined();
    });

    it("returns chat messages for chat prompts", async () => {
      mockPromptGet.mockImplementationOnce(async (name: string) => ({
        config: {},
        labels: [],
        name,
        prompt: [{content: "Hello", role: "user" as const}],
        tags: [],
        type: "chat" as const,
        version: 1,
      }));
      const result = await preparePromptForAI({promptName: "chat"});
      expect(result.messages).toEqual([{content: "Hello", role: "user"}]);
    });
  });

  describe("createTelemetryConfig", () => {
    it("builds a telemetry config with userId and metadata", () => {
      const t = createTelemetryConfig({
        functionId: "fn-1",
        metadata: {foo: "bar"},
        userId: "user-1",
      });
      expect(t.functionId).toBe("fn-1");
      expect(t.isEnabled).toBe(true);
      expect(t.metadata).toEqual({foo: "bar", userId: "user-1"});
    });

    it("omits userId when not provided", () => {
      const t = createTelemetryConfig({functionId: "fn-2"});
      expect(t.metadata).toEqual({});
    });
  });
});
