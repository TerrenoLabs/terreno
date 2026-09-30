import {afterEach, beforeEach, describe, it} from "bun:test";
import {BackgroundTask} from "@terreno/api";
import {assert} from "chai";

import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {LocalDatasetStore} from "./datasetStore";
import {LocalEvaluatorStore} from "./evaluatorStore";
import {LocalExperimentRunner} from "./experimentRunner";
import {createLocalObservabilityBundle} from "./localPlugin";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptLabel} from "./models/obsPromptLabel";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {LocalPromptStore} from "./promptStore";

const createTestRunner = (params: {
  datasetStore: LocalDatasetStore;
  evaluatorStore: LocalEvaluatorStore;
  generateText: (options: {systemPrompt?: string}) => Promise<string>;
  promptStore: LocalPromptStore;
}): LocalExperimentRunner => {
  const runner = new LocalExperimentRunner({
    backgroundTaskRunner: {
      enqueue: async ({execute, taskType}) => {
        const task = await BackgroundTask.create({status: "pending", taskType});
        await execute();
        return {taskId: String(task._id)};
      },
    },
    datasetStore: params.datasetStore,
    evaluatorStore: params.evaluatorStore,
    promptStore: params.promptStore,
  });
  runner.configureAi({
    aiService: {
      generateJsonObject: async () => {
        return {correct: true};
      },
      generateText: params.generateText,
      modelId: "mock-model",
    },
  });
  return runner;
};

describe("LocalExperimentRunner", () => {
  let promptStore: LocalPromptStore;
  let datasetStore: LocalDatasetStore;
  let evaluatorStore: LocalEvaluatorStore;
  let runner: LocalExperimentRunner;

  beforeEach(async () => {
    createLocalObservabilityBundle();
    promptStore = new LocalPromptStore();
    datasetStore = new LocalDatasetStore(promptStore);
    evaluatorStore = new LocalEvaluatorStore(promptStore);
    await registerObsDataset().deleteMany({});
    await registerObsDatasetItem().deleteMany({});
    await registerObsEvaluator().deleteMany({});
    await registerObsExperiment().deleteMany({});
    await registerObsPrompt().deleteMany({});
    await registerObsPromptVersion().deleteMany({});
    await registerObsPromptLabel().deleteMany({});
    await BackgroundTask.deleteMany({});
    new ObservabilityApp({plugins: [createLocalObservabilityBundle().plugin]});

    await promptStore.create({
      folder: "examples",
      name: "exp-prompt",
      outputSchema: {
        properties: {answer: {type: "string"}},
        type: "object",
      },
      system: "Answer briefly v1",
      template: "Question: {{question}}",
      type: "text",
      variables: [{key: "question", required: true}],
    });
    await promptStore.createVersion("exp-prompt", {
      system: "Answer briefly v2",
      template: "Question: {{question}}",
      type: "text",
      variables: [{key: "question", required: true}],
    });
    await promptStore.moveLabel("exp-prompt", {label: "production", version: 2});

    runner = createTestRunner({
      datasetStore,
      evaluatorStore,
      generateText: async () => {
        return JSON.stringify({answer: "ok"});
      },
      promptStore,
    });
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  it("runs a one-item experiment through BackgroundTask and computes gates", async () => {
    const dataset = await datasetStore.create({name: "exp-dataset"});
    await datasetStore.createItem(dataset.id, {
      input: {question: "2+2"},
      proofread: true,
    });
    const evaluator = await evaluatorStore.create({
      assertion: {constraint: "exists", path: "answer"},
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "correctness",
      target: "generation span",
      type: "json-assert",
    });
    const experiment = await runner.create({
      datasetId: dataset.id,
      evaluatorIds: [evaluator.id],
      name: "gate-run",
      promptName: "exp-prompt",
      thresholds: [
        {
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "correctness",
          op: "eq",
          value: 1,
        },
      ],
      versions: [1, 2],
    });
    assert.isOk(experiment.backgroundTaskId);
    const detail = await runner.get(experiment.id);
    assert.equal(detail.items.length, 1);
    assert.isAtLeast(Object.keys(detail.items[0]?.versionResults ?? {}).length, 2);
    const v1Gate = detail.results?.gates.find((gate) => {
      return gate.version === 1;
    });
    const v2Gate = detail.results?.gates.find((gate) => {
      return gate.version === 2;
    });
    assert.equal(v1Gate?.passed, true);
    assert.equal(v2Gate?.passed, true);
  });

  it("rejects human evaluators when creating an experiment", async () => {
    const human = await evaluatorStore.create({
      dimensions: [{dataType: "boolean", key: "pass", required: true}],
      instructions: "Review the answer.",
      name: "human-review",
      target: "full trace",
      type: "human",
    });
    try {
      await runner.create({
        datasetId: "missing-dataset",
        evaluatorIds: [human.id],
        name: "human-run",
        promptName: "exp-prompt",
        versions: [1, 2],
      });
      assert.fail("expected human evaluator rejection");
    } catch (error) {
      assert.equal(
        (error as Error).message,
        "Experiments only accept llm-judge and json-assert evaluators"
      );
    }
  });

  it("excludes unproofread items unless includeUnproofread is true", async () => {
    const dataset = await datasetStore.create({name: "filter-dataset"});
    await datasetStore.createItem(dataset.id, {input: {question: "kept"}, proofread: true});
    await datasetStore.createItem(dataset.id, {input: {question: "skipped"}, proofread: false});
    const estimateDefault = await runner.estimate({
      datasetId: dataset.id,
      evaluatorIds: [],
      versions: [1, 2],
    });
    assert.equal(estimateDefault.generations, 2);
    const estimateAll = await runner.estimate({
      datasetId: dataset.id,
      evaluatorIds: [],
      includeUnproofread: true,
      versions: [1, 2],
    });
    assert.equal(estimateAll.generations, 4);
  });

  it("returns 409 on promote when a gate fails and moves production when gates pass", async () => {
    const dataset = await datasetStore.create({name: "promote-dataset"});
    await datasetStore.createItem(dataset.id, {
      input: {question: "promote"},
      proofread: true,
    });
    const evaluator = await evaluatorStore.create({
      assertion: {constraint: "eq:wrong", path: "answer"},
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "correctness",
      target: "generation span",
      type: "json-assert",
    });
    const experiment = await runner.create({
      datasetId: dataset.id,
      evaluatorIds: [evaluator.id],
      name: "promote-run",
      promptName: "exp-prompt",
      thresholds: [
        {
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "correctness",
          op: "eq",
          value: 1,
        },
      ],
      versions: [1, 2],
    });
    try {
      await runner.promote(experiment.id, 2);
      assert.fail("expected promote to be blocked");
    } catch (error) {
      assert.match(String(error), /Promote blocked|gate failed/i);
    }

    const passingEvaluator = await evaluatorStore.create({
      assertion: {constraint: "exists", path: "answer"},
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "passing",
      target: "generation span",
      type: "json-assert",
    });
    const passingExperiment = await runner.create({
      datasetId: dataset.id,
      evaluatorIds: [passingEvaluator.id],
      name: "passing-run",
      promptName: "exp-prompt",
      thresholds: [
        {
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "passing",
          op: "eq",
          value: 1,
        },
      ],
      versions: [1, 2],
    });
    const promoted = await runner.promote(passingExperiment.id, 2);
    assert.equal(promoted.version, 2);
    const production = await promptStore.get({label: "production", name: "exp-prompt"});
    assert.equal(production?.version, 2);
  });

  it("blocks promote for a failing version while another version passes gates", async () => {
    runner = createTestRunner({
      datasetStore,
      evaluatorStore,
      generateText: async ({systemPrompt}) => {
        if (systemPrompt?.includes("v2")) {
          return JSON.stringify({answer: "good"});
        }
        return JSON.stringify({answer: "bad"});
      },
      promptStore,
    });

    const dataset = await datasetStore.create({name: "split-gates"});
    await datasetStore.createItem(dataset.id, {
      input: {question: "split"},
      proofread: true,
    });
    const evaluator = await evaluatorStore.create({
      assertion: {constraint: 'eq:"good"', path: "answer"},
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "correctness",
      target: "generation span",
      type: "json-assert",
    });
    const experiment = await runner.create({
      datasetId: dataset.id,
      evaluatorIds: [evaluator.id],
      name: "split-run",
      promptName: "exp-prompt",
      thresholds: [
        {
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "correctness",
          op: "eq",
          value: 1,
        },
      ],
      versions: [1, 2],
    });
    const detail = await runner.get(experiment.id);
    const v1Gate = detail.results?.gates.find((gate) => {
      return gate.version === 1;
    });
    const v2Gate = detail.results?.gates.find((gate) => {
      return gate.version === 2;
    });
    assert.equal(v1Gate?.passed, false);
    assert.equal(v2Gate?.passed, true);

    try {
      await runner.promote(experiment.id, 1);
      assert.fail("expected v1 promote to be blocked");
    } catch (error) {
      assert.match(String(error), /v1/);
    }

    const promoted = await runner.promote(experiment.id, 2);
    assert.equal(promoted.version, 2);
  });

  it("rejects unsupported modelOverride when no factory is configured", async () => {
    try {
      await runner.create({
        datasetId: (await datasetStore.create({name: "override"})).id,
        evaluatorIds: [],
        modelOverride: "unknown-model",
        name: "override-run",
        promptName: "exp-prompt",
        versions: [1, 2],
      });
      assert.fail("expected modelOverride rejection");
    } catch (error) {
      assert.match(String(error), /aiServiceFactory|Unsupported modelOverride/);
    }
  });

  it("lists experiments and evaluates mean gates with the default background runner", async () => {
    const defaultRunner = new LocalExperimentRunner({
      datasetStore,
      evaluatorStore,
      promptStore,
    });
    defaultRunner.configureAi({
      aiService: {
        generateJsonObject: async () => {
          return {correct: true};
        },
        generateText: async () => {
          return JSON.stringify({answer: "ok"});
        },
        modelId: "mock-model",
      },
    });

    const dataset = await datasetStore.create({name: "mean-dataset"});
    await datasetStore.createItem(dataset.id, {
      input: {question: "score"},
      proofread: true,
    });
    const evaluator = await evaluatorStore.create({
      assertion: {constraint: "exists", path: "answer"},
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "quality-score",
      target: "generation span",
      type: "json-assert",
    });
    const experiment = await defaultRunner.create({
      datasetId: dataset.id,
      evaluatorIds: [evaluator.id],
      name: "mean-run",
      promptName: "exp-prompt",
      thresholds: [
        {
          aggregate: "mean",
          dimension: "correct",
          evaluatorName: "quality-score",
          op: "gte",
          value: 0.5,
        },
      ],
      versions: [1, 2],
    });
    let detail = await defaultRunner.get(experiment.id);
    for (let attempt = 0; attempt < 20 && detail.status === "running"; attempt += 1) {
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 25);
      });
      detail = await defaultRunner.get(experiment.id);
    }
    const listed = await defaultRunner.list();
    assert.isAtLeast(listed.length, 1);
    assert.equal(detail.status, "completed");
    assert.equal(detail.results?.gates[0]?.aggregate, "mean");
  });

  it("marks experiments failed when generation throws", async () => {
    const failingRunner = new LocalExperimentRunner({
      datasetStore,
      evaluatorStore,
      promptStore,
    });
    failingRunner.configureAi({
      aiService: {
        generateJsonObject: async () => {
          return {correct: true};
        },
        generateText: async () => {
          throw new Error("generation failed");
        },
        modelId: "mock-model",
      },
    });
    const dataset = await datasetStore.create({name: "fail-dataset"});
    await datasetStore.createItem(dataset.id, {
      input: {question: "boom"},
      proofread: true,
    });
    const experiment = await failingRunner.create({
      datasetId: dataset.id,
      evaluatorIds: [],
      name: "fail-run",
      promptName: "exp-prompt",
      versions: [1, 2],
    });
    let detail = await failingRunner.get(experiment.id);
    for (let attempt = 0; attempt < 20 && detail.status === "running"; attempt += 1) {
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 25);
      });
      detail = await failingRunner.get(experiment.id);
    }
    const task = await BackgroundTask.findExactlyOne({_id: detail.backgroundTaskId});
    assert.equal(task.status, "failed");
    assert.include(task.error ?? "", "generation failed");
  });
});
