import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type {LanguageModel} from "ai";
import type express from "express";

import {AIService} from "../../service/aiService";
import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import type {ObservabilityPlugin} from "../types";

const createLangfusePlugin = (): ObservabilityPlugin => {
  return {
    capabilities: new Set(["datasets", "experiments", "prompts", "scores", "traces"]),
    datasetStore: {},
    experimentRunner: {},
    id: "langfuse",
    promptRegistry: {get: async () => undefined},
    scoreSink: {export: async () => {}},
    traceSink: {export: async () => {}},
  };
};

describe("observability status routes", () => {
  let app: express.Application;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(() => {
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(
        new ObservabilityApp({
          plugins: [createLocalObservabilityPlugin(), createLangfusePlugin()],
        })
      )
      .build();
  });

  it("returns plugin ids, capabilities, primaries, and local-on for admins", async () => {
    const agent = await authAsUser(app, "admin");
    const response = await agent.get("/ai/observability/status");
    expect(response.status).toBe(200);
    expect(response.body.data.localOn).toBe(true);
    expect(response.body.data.primaries).toEqual({
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    });
    expect(response.body.data.plugins.map((plugin: {id: string}) => plugin.id)).toEqual([
      "local",
      "langfuse",
    ]);
    expect(response.body.data.plugins[0].capabilities).toContain("reviewQueue");
  });

  it("rejects non-admin callers", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const response = await agent.get("/ai/observability/status");
    expect(response.status).toBe(403);
  });

  it("reports playgroundAi source for server, request-key, and unavailable setups", async () => {
    const unavailableAgent = await authAsUser(app, "admin");
    const unavailable = await unavailableAgent.get("/ai/observability/status");
    expect(unavailable.body.data.playgroundAi).toEqual({source: "unavailable"});

    const model = {
      doGenerate: mock(async () => ({
        content: [{text: "ok", type: "text" as const}],
        finishReason: "stop" as const,
        usage: {inputTokens: 1, outputTokens: 1},
      })),
      doStream: mock(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      })),
      modelId: "mock-model",
      provider: "mock-provider",
      specificationVersion: "v2" as const,
      supportedUrls: {},
    };
    const serverApp = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(
        new ObservabilityApp({
          aiService: new AIService({model: model as unknown as LanguageModel}),
          plugins: [createLocalObservabilityPlugin()],
        })
      )
      .build();
    const serverAgent = await authAsUser(serverApp, "admin");
    const serverStatus = await serverAgent.get("/ai/observability/status");
    expect(serverStatus.body.data.playgroundAi).toEqual({source: "server"});

    const requestKeyApp = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(
        new ObservabilityApp({
          plugins: [createLocalObservabilityPlugin()],
          requestAiServiceFactory: () => undefined,
        })
      )
      .build();
    const requestKeyAgent = await authAsUser(requestKeyApp, "admin");
    const requestKeyStatus = await requestKeyAgent.get("/ai/observability/status");
    expect(requestKeyStatus.body.data.playgroundAi).toEqual({source: "request-key"});
  });
});
