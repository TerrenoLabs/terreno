import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type {LanguageModel} from "ai";
import {assert} from "chai";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {AIRequest} from "../../models/aiRequest";
import {AIService} from "../../service/aiService";
import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsExperiment} from "../local/models/obsExperiment";
import {registerObsPrompt} from "../local/models/obsPrompt";
import {registerObsPromptLabel} from "../local/models/obsPromptLabel";
import {registerObsPromptVersion} from "../local/models/obsPromptVersion";
import {registerObsTrace} from "../local/models/obsTrace";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";

const createMockModel = (responseText = "Playground output") => {
  return {
    doGenerate: mock(async () => ({
      content: [{text: responseText, type: "text" as const}],
      finishReason: "stop" as const,
      usage: {inputTokens: 5, outputTokens: 10},
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
};

describe("observability prompt routes", () => {
  let aiService: AIService;
  let app: express.Application;
  let doGenerate: ReturnType<typeof mock>;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsPrompt().deleteMany({});
    await registerObsPromptVersion().deleteMany({});
    await registerObsPromptLabel().deleteMany({});
    await registerObsTrace().deleteMany({});
    await AIRequest.deleteMany({});

    const model = createMockModel();
    doGenerate = model.doGenerate;
    aiService = new AIService({model: model as unknown as LanguageModel});
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(
        new ObservabilityApp({
          aiService,
          plugins: [createLocalObservabilityPlugin()],
          priceMap: {"mock-model": {inputPerMTok: 1000, outputPerMTok: 2000}},
        })
      )
      .build();
  });

  it("creates versions, pins production, and runs playground without a new version", async () => {
    const agent = await authAsUser(app, "admin");

    const created = await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "greeter",
      system: "Greet {{name}}",
      template: "Say hello to {{name}}",
      type: "text",
    });
    expect(created.status).toBe(201);

    await agent.post("/ai/observability/prompts/greeter/labels").send({
      label: "production",
      version: 1,
    });
    const v2 = await agent.post("/ai/observability/prompts/greeter/versions").send({
      system: "Greet politely {{name}}",
      template: "Hi {{name}}",
      type: "text",
    });
    expect(v2.status).toBe(201);
    expect(v2.body.data.version).toBe(2);

    const moved = await agent.post("/ai/observability/prompts/greeter/labels").send({
      label: "production",
      version: 2,
    });
    expect(moved.body.data.outgoingVersion).toBe(1);

    const detail = await agent.get("/ai/observability/prompts/greeter");
    expect(detail.body.data.versions[0].system).toBe("Greet {{name}}");
    expect(detail.body.data.versions).toHaveLength(2);
    assert.match(detail.body.data.versions[0].created, /^\d{4}-\d{2}-\d{2}T/);

    const playground = await agent.post("/ai/observability/prompts/greeter/playground").send({
      variables: {name: "Ada"},
      version: 1,
    });
    expect(playground.status).toBe(200);
    expect(playground.body.data.compiledMessages).toEqual([
      {content: "Greet Ada", role: "system"},
      {content: "Say hello to Ada", role: "user"},
    ]);
    expect(playground.body.data.output).toBe("Playground output");
    expect(playground.body.data.tokens).toEqual({
      inputTokens: 5,
      outputTokens: 10,
      totalTokens: 15,
    });
    expect(playground.body.data.costUsd).toBeCloseTo(0.025);
    expect(playground.body.data.latencyMs).toBeGreaterThanOrEqual(0);
    expect(doGenerate).toHaveBeenCalledTimes(1);

    const after = await agent.get("/ai/observability/prompts/greeter");
    expect(after.body.data.versions).toHaveLength(2);
  });

  it("uses a request-scoped AI service when the server service is unavailable", async () => {
    const requestAiServiceFactory = mock(({apiKey}: {apiKey?: string}) => {
      return apiKey === "request-key" ? aiService : undefined;
    });
    const requestServiceApp = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(
        new ObservabilityApp({
          plugins: [createLocalObservabilityPlugin()],
          requestAiServiceFactory,
        })
      )
      .build();
    const agent = await authAsUser(requestServiceApp, "admin");
    await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "request-key-greeter",
      template: "Hello {{name}}",
      type: "text",
      variables: [{key: "name", required: true}],
    });

    const playground = await agent
      .post("/ai/observability/prompts/request-key-greeter/playground")
      .set("x-ai-api-key", "request-key")
      .send({variables: {name: "Ada"}, version: 1});

    assert.equal(playground.status, 200);
    assert.equal(playground.body.data.output, "Playground output");
    assert.equal(requestAiServiceFactory.mock.calls[0]?.[0].apiKey, "request-key");
  });

  it("forbids non-admins from creating prompts", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "blocked",
      type: "text",
    });
    expect(res.status).toBe(403);
  });

  it("round-trips description on list/detail and omits it for legacy prompts", async () => {
    const agent = await authAsUser(app, "admin");
    await agent.post("/ai/observability/prompts").send({
      description: "Operator-facing summary of what this prompt does",
      folder: "examples",
      name: "described",
      system: "Hello",
      type: "text",
    });
    await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "legacy-prompt",
      system: "Legacy",
      type: "text",
    });

    const listed = await agent.get("/ai/observability/prompts?folder=examples&search=desc");
    expect(listed.status).toBe(200);
    expect(listed.body.data[0]?.description).toBe(
      "Operator-facing summary of what this prompt does"
    );
    expect(
      listed.body.data.find((row: {name: string}) => row.name === "legacy-prompt")?.description
    ).toBeUndefined();

    const legacyDetail = await agent.get("/ai/observability/prompts/legacy-prompt");
    expect(legacyDetail.status).toBe(200);
    expect(legacyDetail.body.data.description).toBeUndefined();
  });

  it("returns bounded prompt relationships with version evidence and unrelated exclusions", async () => {
    const agent = await authAsUser(app, "admin");
    await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "hub-http",
      system: "v1",
      type: "text",
    });
    await agent.post("/ai/observability/prompts/hub-http/versions").send({
      system: "v2",
      type: "text",
    });

    const ObsTrace = registerObsTrace();
    for (let index = 0; index < 23; index += 1) {
      await ObsTrace.create({
        name: `hub-trace-${index}`,
        prompts: [{name: "hub-http", version: index % 2 === 0 ? 2 : 1}],
        startedAt: DateTime.utc().minus({minutes: index}).toJSDate(),
        status: "ok",
      });
    }
    await ObsTrace.create({
      name: "foreign-trace",
      prompts: [{name: "other", version: 1}],
      startedAt: DateTime.utc().toJSDate(),
      status: "ok",
    });

    const ObsExperiment = registerObsExperiment();
    await ObsExperiment.create({
      datasetId: new mongoose.Types.ObjectId(),
      evaluatorIds: [],
      name: "hub-experiment",
      promptName: "hub-http",
      status: "completed",
      thresholds: [],
      versions: [1, 2],
    });
    await ObsExperiment.create({
      datasetId: new mongoose.Types.ObjectId(),
      evaluatorIds: [],
      name: "foreign-experiment",
      promptName: "other",
      status: "pending",
      thresholds: [],
      versions: [1, 2],
    });

    const detail = await agent.get("/ai/observability/prompts/hub-http");
    expect(detail.status).toBe(200);
    expect(detail.body.data.relationships.traces.total).toBe(23);
    expect(detail.body.data.relationships.traces.limit).toBe(20);
    expect(detail.body.data.relationships.traces.items).toHaveLength(20);
    expect(
      detail.body.data.relationships.traces.items.every((row: {promptName: string}) => {
        return row.promptName === "hub-http";
      })
    ).toBe(true);
    expect(
      detail.body.data.relationships.traces.items.some((row: {promptVersion: number}) => {
        return row.promptVersion === 2;
      })
    ).toBe(true);
    expect(detail.body.data.relationships.experiments.total).toBe(1);
    expect(detail.body.data.relationships.experiments.items).toEqual([
      expect.objectContaining({name: "hub-experiment", promptName: "hub-http"}),
    ]);
    expect(
      detail.body.data.relationships.traces.items.some((row: {name: string}) => {
        return row.name === "foreign-trace";
      })
    ).toBe(false);

    const v2Only = await agent.get("/ai/observability/prompts/hub-http?promptVersion=2");
    expect(v2Only.status).toBe(200);
    expect(
      v2Only.body.data.relationships.traces.items.every((row: {promptVersion: number}) => {
        return row.promptVersion === 2;
      })
    ).toBe(true);
    expect(
      v2Only.body.data.relationships.traces.items.some((row: {promptVersion: number}) => {
        return row.promptVersion === 1;
      })
    ).toBe(false);

    const badVersion = await agent.get("/ai/observability/prompts/hub-http?promptVersion=0");
    expect(badVersion.status).toBe(400);
    const fractional = await agent.get("/ai/observability/prompts/hub-http?promptVersion=1.5");
    expect(fractional.status).toBe(400);
  });

  it("lists folder matches with usage7d and — when production is unset", async () => {
    const agent = await authAsUser(app, "admin");
    await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "summarize",
      system: "Summarize",
      type: "text",
    });
    const listed = await agent.get(
      "/ai/observability/prompts?folder=examples&search=sum&include=usage7d"
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      {
        folder: "examples",
        latestVersion: 1,
        name: "summarize",
        production: "—",
        type: "text",
        usage7d: {calls: 0},
      },
    ]);
  });
});
