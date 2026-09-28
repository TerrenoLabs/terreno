import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {BackgroundTask, TerrenoApp} from "@terreno/api";
import type {LanguageModel} from "ai";
import type express from "express";

import {AIService} from "../../service/aiService";
import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsDataset} from "../local/models/obsDataset";
import {registerObsDatasetItem} from "../local/models/obsDatasetItem";
import {registerObsEvaluator} from "../local/models/obsEvaluator";
import {registerObsExperiment} from "../local/models/obsExperiment";
import {registerObsExperimentItem} from "../local/models/obsExperimentItem";
import {registerObsPrompt} from "../local/models/obsPrompt";
import {registerObsPromptLabel} from "../local/models/obsPromptLabel";
import {registerObsPromptVersion} from "../local/models/obsPromptVersion";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";

const createMockModel = (responseText = JSON.stringify({answer: "ok"})) => {
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

describe("observability experiment routes", () => {
  let app: express.Application;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsDataset().deleteMany({});
    await registerObsDatasetItem().deleteMany({});
    await registerObsEvaluator().deleteMany({});
    await registerObsExperiment().deleteMany({});
    await registerObsExperimentItem().deleteMany({});
    await registerObsPrompt().deleteMany({});
    await registerObsPromptVersion().deleteMany({});
    await registerObsPromptLabel().deleteMany({});
    await BackgroundTask.deleteMany({});

    const model = createMockModel();
    const aiService = new AIService({model: model as unknown as LanguageModel});
    const plugin = createLocalObservabilityPlugin({
      backgroundTaskRunner: {
        enqueue: async ({execute, taskType}) => {
          const task = await BackgroundTask.create({status: "pending", taskType});
          await execute();
          return {taskId: String(task._id)};
        },
      },
    });
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(
        new ObservabilityApp({
          aiService,
          plugins: [plugin],
        })
      )
      .build();
  });

  const seedExperimentFixtures = async (
    agent: Awaited<ReturnType<typeof authAsUser>>
  ): Promise<{datasetId: string; evaluatorId: string; promptName: string}> => {
    const prompt = await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "route-exp-prompt",
      outputSchema: {properties: {answer: {type: "string"}}, type: "object"},
      system: "v1 system",
      template: "Q: {{question}}",
      type: "text",
      variables: [{key: "question", required: true}],
    });
    expect(prompt.status).toBe(201);
    await agent.post("/ai/observability/prompts/route-exp-prompt/versions").send({
      system: "v2 system",
      template: "Q: {{question}}",
      type: "text",
      variables: [{key: "question", required: true}],
    });

    const dataset = await agent
      .post("/ai/observability/datasets")
      .send({name: "route-exp-dataset"});
    const datasetId = dataset.body.data.id as string;
    await agent.post(`/ai/observability/datasets/${datasetId}/items`).send({
      input: {question: "2+2"},
      proofread: true,
    });

    const evaluator = await agent.post("/ai/observability/evaluators").send({
      assertion: {constraint: "exists", path: "answer"},
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "route-correctness",
      target: "full trace",
      type: "json-assert",
    });

    return {
      datasetId,
      evaluatorId: evaluator.body.data.id as string,
      promptName: "route-exp-prompt",
    };
  };

  it("rejects experiment create for non-admin users", async () => {
    const admin = await authAsUser(app, "admin");
    const fixtures = await seedExperimentFixtures(admin);
    const user = await authAsUser(app, "notAdmin");
    const denied = await user.post("/ai/observability/experiments").send({
      datasetId: fixtures.datasetId,
      evaluatorIds: [fixtures.evaluatorId],
      name: "denied",
      promptName: fixtures.promptName,
      versions: [1, 2],
    });
    expect(denied.status).toBe(403);
  });

  it("creates, returns detail with per-version gates, and promotes a passing version", async () => {
    const admin = await authAsUser(app, "admin");
    const fixtures = await seedExperimentFixtures(admin);

    const created = await admin.post("/ai/observability/experiments").send({
      datasetId: fixtures.datasetId,
      evaluatorIds: [fixtures.evaluatorId],
      name: "route-run",
      promptName: fixtures.promptName,
      thresholds: [
        {
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "route-correctness",
          op: "eq",
          value: 1,
        },
      ],
      versions: [1, 2],
    });
    expect(created.status).toBe(201);
    const experimentId = created.body.data.id as string;

    const detail = await admin.get(`/ai/observability/experiments/${experimentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.items.length).toBeGreaterThan(0);
    expect(
      detail.body.data.results.gates.some((gate: {version: number}) => gate.version === 1)
    ).toBe(true);
    expect(
      detail.body.data.results.gates.some((gate: {version: number}) => gate.version === 2)
    ).toBe(true);

    const promoted = await admin
      .post(`/ai/observability/experiments/${experimentId}/promote`)
      .send({version: 2});
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.version).toBe(2);
  });

  it("lists experiments and returns estimates", async () => {
    const admin = await authAsUser(app, "admin");
    const fixtures = await seedExperimentFixtures(admin);

    const listed = await admin.get("/ai/observability/experiments");
    expect(listed.status).toBe(200);

    const estimate = await admin.post("/ai/observability/experiments/estimate").send({
      datasetId: fixtures.datasetId,
      evaluatorIds: [fixtures.evaluatorId],
      promptName: fixtures.promptName,
      versions: [1, 2],
    });
    expect(estimate.status).toBe(200);
    expect(estimate.body.data.generations).toBeGreaterThan(0);
  });

  it("rejects human evaluators when creating an experiment", async () => {
    const admin = await authAsUser(app, "admin");
    const fixtures = await seedExperimentFixtures(admin);
    const human = await admin.post("/ai/observability/evaluators").send({
      dimensions: [{dataType: "boolean", key: "pass", required: true}],
      instructions: "Review the answer.",
      name: "human-review",
      target: "full trace",
      type: "human",
    });
    expect(human.status).toBe(201);

    const created = await admin.post("/ai/observability/experiments").send({
      datasetId: fixtures.datasetId,
      evaluatorIds: [human.body.data.id],
      name: "human-run",
      promptName: fixtures.promptName,
      versions: [1, 2],
    });
    expect(created.status).toBe(400);
    expect(created.body.title).toBe("Experiments only accept llm-judge and json-assert evaluators");
  });
});
