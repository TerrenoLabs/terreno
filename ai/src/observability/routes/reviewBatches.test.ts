import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";
import {DateTime} from "luxon";

import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {LocalEvaluatorStore} from "../local/evaluatorStore";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsDataset} from "../local/models/obsDataset";
import {registerObsDatasetItem} from "../local/models/obsDatasetItem";
import {registerObsEvaluator} from "../local/models/obsEvaluator";
import {registerObsJudgeRun} from "../local/models/obsJudgeRun";
import {registerObsReviewBatch} from "../local/models/obsReviewBatch";
import {registerObsReviewItem} from "../local/models/obsReviewItem";
import {registerObsTrace} from "../local/models/obsTrace";
import {LocalPromptStore} from "../local/promptStore";
import {LocalTraceStore} from "../local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import type {ObservabilityGenerateClient} from "../types";

const judgeClient: ObservabilityGenerateClient = {
  generateJsonObject: async <OBJECT>() => ({confidence: 0.9, faithful: true}) as OBJECT,
  generateText: async () => "",
  modelId: "route-judge",
};

const buildApp = (aiService?: ObservabilityGenerateClient): express.Application => {
  return new TerrenoApp({skipListen: true, userModel: UserModel})
    .register(new ObservabilityApp({aiService, plugins: [createLocalObservabilityPlugin()]}))
    .build();
};

describe("observability review batch routes", () => {
  let questionSetId: string;
  let judgeId: string;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsReviewItem().deleteMany({});
    await registerObsReviewBatch().deleteMany({});
    await registerObsDataset().deleteMany({});
    await registerObsDatasetItem().deleteMany({});
    await registerObsJudgeRun().deleteMany({});
    await registerObsEvaluator().deleteMany({});
    await registerObsTrace().deleteMany({});
    // Register the models and default local stores before seeding fixtures.
    buildApp();
    resetObservabilityApp();
    const promptStore = new LocalPromptStore();
    if (!(await promptStore.getVersionByLabel("route-judge-prompt"))) {
      await promptStore.create({
        folder: "evaluators",
        name: "route-judge-prompt",
        outputSchema: {
          properties: {confidence: {type: "number"}, faithful: {type: "boolean"}},
          required: ["faithful"],
          type: "object",
        },
        type: "chat",
      });
      await promptStore.moveLabel("route-judge-prompt", {label: "production", version: 1});
    }
    const evaluators = new LocalEvaluatorStore(promptStore);
    questionSetId = (
      await evaluators.create({
        dimensions: [
          {dataType: "boolean", key: "faithful", question: "Is it faithful?", required: true},
        ],
        name: "route-questions",
        target: "full trace",
        type: "human",
      })
    ).id;
    judgeId = (
      await evaluators.create({
        dimensions: [{dataType: "boolean", key: "faithful", required: true}],
        judgePromptName: "route-judge-prompt",
        name: "route-judge",
        target: "full trace",
        type: "llm-judge",
      })
    ).id;
    for (let index = 0; index < 3; index += 1) {
      const startedAt = DateTime.utc().minus({hours: index}).toISO() ?? "";
      await new LocalTraceStore().exportTrace({
        id: `t${index}`,
        input: `in ${index}`,
        name: "summarize",
        output: `out ${index}`,
        prompts: [{name: "summarize", version: 1}],
        sensitive: false,
        spans: [{id: "s", kind: "LLM", name: "llm", startedAt, status: "ok"}],
        startedAt,
        status: "ok",
      });
    }
  });

  it("creates a batch from recent traces, answers it, and compares a judge", async () => {
    const app = buildApp(judgeClient);
    const agent = await authAsUser(app, "admin");
    const created = await agent
      .post("/ai/observability/review/batches")
      .send({evaluatorId: questionSetId, limit: 2, promptName: "summarize"});
    expect(created.status).toBe(201);
    expect(created.body.data.counts.total).toBe(2);
    const batchId = created.body.data.id as string;

    const listed = await agent.get("/ai/observability/review/batches");
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((row: {id: string}) => row.id)).toEqual([batchId]);

    const pending = await agent.get(`/ai/observability/review?status=pending&batchId=${batchId}`);
    expect(pending.body.data).toHaveLength(2);
    for (const item of pending.body.data as Array<{id: string}>) {
      const submitted = await agent
        .post(`/ai/observability/review/${item.id}`)
        .send({action: "submit", scores: {faithful: true}});
      expect(submitted.status).toBe(200);
    }

    const judged = await agent
      .post(`/ai/observability/review/batches/${batchId}/judgeRuns`)
      .send({evaluatorId: judgeId});
    expect(judged.status).toBe(201);
    expect(judged.body.data.judges[0].agreement.rate).toBe(1);
    expect(judged.body.data.judges[0].modelId).toBe("route-judge");

    const detail = await agent.get(`/ai/observability/review/batches/${batchId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.counts.done).toBe(2);
  });

  it("requires an evaluator and an AI client for judge runs", async () => {
    const app = buildApp();
    const agent = await authAsUser(app, "admin");
    const missing = await agent.post("/ai/observability/review/batches").send({});
    expect(missing.status).toBe(400);
    const created = await agent
      .post("/ai/observability/review/batches")
      .send({evaluatorId: questionSetId});
    expect(created.status).toBe(201);
    const judged = await agent
      .post(`/ai/observability/review/batches/${created.body.data.id}/judgeRuns`)
      .send({evaluatorId: judgeId});
    expect(judged.status).toBe(503);
  });

  it("builds a batch from a dataset's unanswered items and records answers on them", async () => {
    const app = buildApp(judgeClient);
    const agent = await authAsUser(app, "admin");
    const dataset = await agent.post("/ai/observability/datasets").send({name: "route-set"});
    const datasetId = dataset.body.data.id as string;
    await agent
      .post(`/ai/observability/datasets/${datasetId}/items`)
      .send({expectedOutput: "summary", input: {text: "todo"}});

    const mixed = await agent
      .post("/ai/observability/review/batches")
      .send({datasetId, evaluatorId: questionSetId, traceIds: []});
    expect(mixed.status).toBe(400);

    const created = await agent
      .post("/ai/observability/review/batches")
      .send({datasetId, evaluatorId: questionSetId});
    expect(created.status).toBe(201);
    expect(created.body.data.datasetId).toBe(datasetId);
    const [item] = created.body.data.items as Array<{datasetItemId: string; reviewItemId: string}>;
    const submitted = await agent
      .post(`/ai/observability/review/${item?.reviewItemId}`)
      .send({action: "submit", scores: {faithful: true}});
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.datasetItemId).toBe(item?.datasetItemId);

    const again = await agent
      .post("/ai/observability/review/batches")
      .send({datasetId, evaluatorId: questionSetId});
    expect(again.status).toBe(400);
    expect(again.body.title).toBe("Every item already has current answers");

    const detail = await agent.get(`/ai/observability/datasets/${datasetId}`);
    expect(detail.body.data.judgments).toEqual([
      {
        answered: 1,
        current: 1,
        evaluatorId: questionSetId,
        evaluatorName: "route-questions",
        stale: 0,
        total: 1,
      },
    ]);
    const items = await agent.get(`/ai/observability/datasets/${datasetId}/items`);
    expect(items.body.data[0].humanAnswers[questionSetId].scores).toEqual({faithful: true});
    expect(items.body.data[0].humanAnswers[questionSetId].userId).toBeDefined();
  });

  it("forbids non-admin users", async () => {
    const agent = await authAsUser(buildApp(judgeClient), "notAdmin");
    const listed = await agent.get("/ai/observability/review/batches");
    expect(listed.status).toBe(403);
  });
});
