import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {BackgroundTask} from "@terreno/api";
import {DateTime} from "luxon";

import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {questionSetFingerprint} from "../questionFingerprint";
import type {ObservabilityGenerateClient} from "../types";
import {LocalDatasetStore} from "./datasetStore";
import {LocalEvaluatorStore} from "./evaluatorStore";
import {LocalExperimentRunner} from "./experimentRunner";
import {loadCurrentHumanAnswers} from "./humanAnswers";
import {createLocalObservabilityPlugin} from "./localPlugin";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsExperimentItem} from "./models/obsExperimentItem";
import {registerObsJudgeRun} from "./models/obsJudgeRun";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptLabel} from "./models/obsPromptLabel";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {registerObsReviewBatch} from "./models/obsReviewBatch";
import {registerObsReviewItem} from "./models/obsReviewItem";
import {registerObsTrace} from "./models/obsTrace";
import {LocalPromptStore} from "./promptStore";
import {LocalReviewBatchStore} from "./reviewBatchStore";
import {LocalReviewStore} from "./reviewStore";
import {LocalTraceStore, MemoryScoreSink} from "./traceStore";

const SLOW_MONGO_TIMEOUT = 120_000;
const USER_ID = "64b000000000000000000001";

const QUESTIONS = [
  {dataType: "boolean" as const, key: "faithful", question: "Is it faithful?", required: true},
  {dataType: "boolean" as const, key: "complete", question: "Is it complete?", required: true},
];

const judgeSchema = {
  properties: {
    complete: {type: "boolean"},
    confidence: {type: "number"},
    faithful: {type: "boolean"},
  },
  required: ["faithful", "complete"],
  type: "object",
};

// v1 ("LENIENT") says yes to everything; v2 ("STRICT") marks outputs containing "bad" unfaithful.
const fakeClient: ObservabilityGenerateClient = {
  generateJsonObject: async <OBJECT>(options: {prompt: string; systemPrompt?: string}) => {
    const strict = options.systemPrompt === "STRICT";
    return {
      complete: true,
      confidence: 0.9,
      faithful: strict ? !options.prompt.includes("bad") : true,
    } as OBJECT;
  },
  generateText: async () => "",
  modelId: "fake-judge",
};

// What reviewers say for each output text.
const HUMAN: Record<string, {complete: boolean; faithful: boolean}> = {
  "bad summary": {complete: true, faithful: false},
  "good summary": {complete: true, faithful: true},
  "manual bad": {complete: true, faithful: false},
};

const exportTrace = async (output: string, hoursAgo: number): Promise<string> => {
  const startedAt = DateTime.utc().minus({hours: hoursAgo}).toISO() ?? "";
  const exported = await new LocalTraceStore().exportTrace({
    id: `t-${hoursAgo}`,
    input: `todo list ${hoursAgo}`,
    name: "summarize",
    output,
    prompts: [{name: "summarize", version: 1}],
    sensitive: false,
    spans: [{id: "s", kind: "LLM", name: "llm", startedAt, status: "ok"}],
    startedAt,
    status: "ok",
  });
  return exported.id;
};

describe("judge calibration pipeline", () => {
  let promptStore: LocalPromptStore;
  let datasetStore: LocalDatasetStore;
  let evaluatorStore: LocalEvaluatorStore;
  let batchStore: LocalReviewBatchStore;
  let reviewStore: LocalReviewStore;
  let runner: LocalExperimentRunner;
  let questionSetId: string;
  let judgeId: string;
  let datasetId: string;

  // Answer every pending item of a batch the way reviewers would.
  const answerBatch = async (batchId: string): Promise<void> => {
    const batch = await batchStore.get(batchId);
    for (const item of batch.items) {
      await reviewStore.submit({
        id: item.reviewItemId,
        scores: HUMAN[String(item.output)] ?? {complete: true, faithful: true},
        sinks: [new MemoryScoreSink()],
        userId: USER_ID,
      });
    }
  };

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    const plugin = createLocalObservabilityPlugin();
    plugin.scoreSink = new MemoryScoreSink();
    new ObservabilityApp({plugins: [plugin]});
    for (const model of [
      registerObsReviewItem(),
      registerObsReviewBatch(),
      registerObsJudgeRun(),
      registerObsEvaluator(),
      registerObsTrace(),
      registerObsPrompt(),
      registerObsPromptVersion(),
      registerObsPromptLabel(),
      registerObsDataset(),
      registerObsDatasetItem(),
      registerObsExperiment(),
      registerObsExperimentItem(),
    ]) {
      await (model as unknown as {deleteMany: (filter: object) => Promise<unknown>}).deleteMany({});
    }
    await BackgroundTask.deleteMany({});
    promptStore = new LocalPromptStore();
    datasetStore = new LocalDatasetStore(promptStore);
    evaluatorStore = new LocalEvaluatorStore(promptStore);
    reviewStore = new LocalReviewStore();
    batchStore = new LocalReviewBatchStore(promptStore, reviewStore);
    runner = new LocalExperimentRunner({
      backgroundTaskRunner: {
        enqueue: async ({execute, taskType}) => {
          const task = await BackgroundTask.create({status: "pending", taskType});
          await execute();
          return {taskId: String(task._id)};
        },
      },
      datasetStore,
      evaluatorStore,
      promptStore,
    });
    runner.configureAi({aiService: fakeClient});

    await promptStore.create({
      folder: "evaluators",
      name: "calib-judge",
      outputSchema: judgeSchema,
      system: "LENIENT",
      type: "chat",
    });
    await promptStore.createVersion("calib-judge", {
      outputSchema: judgeSchema,
      system: "STRICT",
      type: "chat",
    });
    await promptStore.moveLabel("calib-judge", {label: "production", version: 1});
    questionSetId = (
      await evaluatorStore.create({
        dimensions: QUESTIONS,
        name: "summary-questions",
        target: "full trace",
        type: "human",
      })
    ).id;
    judgeId = (
      await evaluatorStore.create({
        dimensions: QUESTIONS.map(({question: _question, ...row}) => row),
        judgePromptName: "calib-judge",
        name: "summary-judge",
        target: "full trace",
        type: "llm-judge",
      })
    ).id;
    datasetId = (await datasetStore.create({name: "calib-set"})).id;
    await datasetStore.addTracesToDataset({
      datasetId,
      traceIds: [await exportTrace("good summary", 2), await exportTrace("bad summary", 1)],
    });
    await datasetStore.createItem(datasetId, {
      expectedOutput: "manual bad",
      input: {text: "manual input"},
    });
  });

  it(
    "builds review batches from a dataset and writes answers back to its items",
    async () => {
      await expect(
        batchStore.create({datasetId, evaluatorId: questionSetId, limit: 5})
      ).rejects.toThrow(/cannot be combined/);

      const batch = await batchStore.create({datasetId, evaluatorId: questionSetId});
      expect(batch.datasetId).toBe(datasetId);
      expect(batch.datasetName).toBe("calib-set");
      expect(batch.questionsFingerprint).toBe(questionSetFingerprint(QUESTIONS));
      expect(batch.questionsStale).toBe(false);
      expect(batch.items).toHaveLength(3);
      expect(batch.items.every((item) => Boolean(item.datasetItemId))).toBe(true);
      const manual = batch.items.find((item) => !item.traceId);
      expect(manual?.input).toEqual({text: "manual input"});
      expect(manual?.output).toBe("manual bad");
      expect(manual?.traceName).toBe("Dataset item");
      const traced = batch.items.find((item) => item.output === "good summary");
      expect(traced?.input).toBe("todo list 2");

      // Items waiting in an open batch are not queued again.
      await expect(batchStore.create({datasetId, evaluatorId: questionSetId})).rejects.toThrow(
        /already waiting in an open review batch/
      );

      const detail = await reviewStore.getDetail(manual?.reviewItemId ?? "");
      expect(detail.traceId).toBeUndefined();
      expect(detail.datasetItemId).toBe(manual?.datasetItemId);
      expect(detail.rawOutput).toBe("manual bad");

      // Submitting writes answers onto the dataset item; scores only reach sinks with a trace.
      const sink = new MemoryScoreSink();
      await reviewStore.submit({
        id: manual?.reviewItemId ?? "",
        scores: {complete: true, faithful: false},
        sinks: [sink],
        userId: USER_ID,
      });
      expect(sink.scores).toHaveLength(0);
      await reviewStore.submit({
        id: traced?.reviewItemId ?? "",
        scores: {complete: true, faithful: true},
        sinks: [sink],
      });
      expect(sink.scores).toHaveLength(2);
      const skipped = batch.items.find((item) => item.output === "bad summary");
      await reviewStore.skip(skipped?.reviewItemId ?? "");

      const items = await datasetStore.listItems(datasetId);
      const manualItem = items.find((item) => item.id === manual?.datasetItemId);
      expect(manualItem?.humanAnswers?.[questionSetId]).toMatchObject({
        fingerprint: questionSetFingerprint(QUESTIONS),
        reviewItemId: manual?.reviewItemId,
        scores: {complete: true, faithful: false},
        userId: USER_ID,
      });
      expect(items.find((item) => item.id === skipped?.datasetItemId)?.humanAnswers).toBe(
        undefined
      );
      let dataset = await datasetStore.get(datasetId);
      expect(dataset.judgments).toEqual([
        {
          answered: 2,
          current: 2,
          evaluatorId: questionSetId,
          evaluatorName: "summary-questions",
          stale: 0,
          total: 3,
        },
      ]);

      // The skipped item is the only one left to judge.
      const followUp = await batchStore.create({datasetId, evaluatorId: questionSetId});
      expect(followUp.items.map((item) => item.datasetItemId)).toEqual([skipped?.datasetItemId]);
      await answerBatch(followUp.id);
      await expect(batchStore.create({datasetId, evaluatorId: questionSetId})).rejects.toThrow(
        "Every item already has current answers"
      );
      expect((await loadCurrentHumanAnswers({datasetId, questionSetId})).items).toHaveLength(3);

      // Editing a question makes every answer stale and the dataset judgeable again.
      await evaluatorStore.update(questionSetId, {
        dimensions: [{...QUESTIONS[0], question: "Is every claim backed?"}, QUESTIONS[1]],
      });
      dataset = (await datasetStore.list()).find((row) => row.id === datasetId) ?? dataset;
      expect(dataset.judgments[0]).toMatchObject({answered: 3, current: 0, stale: 3});
      expect((await loadCurrentHumanAnswers({datasetId, questionSetId})).items).toHaveLength(0);
      expect((await batchStore.list()).every((row) => row.questionsStale)).toBe(true);
      const rejudge = await batchStore.create({datasetId, evaluatorId: questionSetId});
      expect(rejudge.items).toHaveLength(3);
    },
    SLOW_MONGO_TIMEOUT
  );

  it(
    "runs LLM judges over dataset batches without a source trace",
    async () => {
      const batch = await batchStore.create({datasetId, evaluatorId: questionSetId});
      await answerBatch(batch.id);
      await promptStore.moveLabel("calib-judge", {label: "production", version: 2});
      const judged = await batchStore.runJudge({
        ai: {
          generateJsonObject: async <OBJECT>(options: {prompt: string}) => {
            return {complete: true, faithful: !options.prompt.includes("bad")} as OBJECT;
          },
          modelId: "fake",
        },
        batchId: batch.id,
        evaluatorId: judgeId,
      });
      expect(judged.judges[0]?.agreement.rate).toBe(1);
      const manual = judged.items.find((item) => !item.traceId);
      expect(manual?.judgeAnswers[judgeId]?.scores).toEqual({complete: true, faithful: false});
    },
    SLOW_MONGO_TIMEOUT
  );

  it(
    "ranks judge prompt versions by agreement with human answers and calibrates the judge",
    async () => {
      const base = {datasetId, judgeEvaluatorId: judgeId, kind: "judge" as const, name: "Calib"};
      await expect(runner.create({...base, questionSetId, versions: [1, 2]})).rejects.toThrow(
        "Dataset has no current human answers for this question set"
      );

      await answerBatch((await batchStore.create({datasetId, evaluatorId: questionSetId})).id);

      await expect(runner.create({...base, questionSetId, versions: [1]})).rejects.toThrow(
        /2–3 judge prompt versions/
      );
      await expect(runner.create({...base, questionSetId, versions: [1, 9]})).rejects.toThrow(
        "Unknown judge prompt version"
      );
      await expect(
        runner.create({...base, questionSetId: judgeId, versions: [1, 2]})
      ).rejects.toThrow("questionSetId must be a human question set");
      await expect(
        runner.create({...base, judgeEvaluatorId: questionSetId, questionSetId, versions: [1, 2]})
      ).rejects.toThrow(/must be an llm-judge evaluator/);
      await expect(
        runner.create({...base, questionSetId, targetAgreement: 1.5, versions: [1, 2]})
      ).rejects.toThrow(/targetAgreement/);

      const created = await runner.create({...base, questionSetId, versions: [1, 2]});
      const experiment = await runner.get(created.id);
      expect(experiment.kind).toBe("judge");
      expect(experiment.status).toBe("completed");
      expect(experiment.promptName).toBe("calib-judge");
      expect(experiment.judgeName).toBe("summary-judge");
      expect(experiment.questionSetName).toBe("summary-questions");
      expect(experiment.datasetName).toBe("calib-set");
      expect(experiment.targetAgreement).toBe(0.9);
      expect(experiment.questionsStale).toBe(false);
      expect(experiment.results?.progress).toEqual({completed: 3, total: 3});
      const v1 = experiment.results?.agreement?.["1"];
      const v2 = experiment.results?.agreement?.["2"];
      expect(v1?.rate).toBeCloseTo(4 / 6, 5);
      expect(v2?.rate).toBe(1);
      expect(v1?.disagreements).toHaveLength(2);
      expect(v1?.disagreements.every((row) => Boolean(row.datasetItemId))).toBe(true);
      expect(experiment.results?.gates).toEqual([
        {
          actual: v1?.rate,
          aggregate: "agreement",
          dimension: "agreement",
          evaluatorName: "summary-judge",
          op: "gte",
          passed: false,
          value: 0.9,
          version: 1,
        },
        {
          actual: 1,
          aggregate: "agreement",
          dimension: "agreement",
          evaluatorName: "summary-judge",
          op: "gte",
          passed: true,
          value: 0.9,
          version: 2,
        },
      ]);
      expect(experiment.items).toHaveLength(3);
      expect(experiment.items.filter((item) => item.failed)).toHaveLength(2);
      const failed = experiment.items.find((item) => item.failed);
      expect(failed?.humanScores).toEqual({complete: true, faithful: false});
      expect(failed?.versionResults["1"]?.evaluatorScores[judgeId]?.scores).toEqual({
        complete: true,
        faithful: true,
      });

      expect((await runner.list({kind: "judge"})).data).toHaveLength(1);
      expect((await runner.list({kind: "prompt"})).data).toHaveLength(0);

      // Before promote the production judge is v1, which failed its gate.
      let calibration = (await evaluatorStore.get(judgeId)).calibration;
      expect(calibration).toMatchObject({passed: false, stale: false, version: 1});

      await expect(runner.promote(created.id, 1)).rejects.toThrow(/Promote blocked/);
      await runner.promote(created.id, 2);
      expect((await promptStore.getVersionByLabel("calib-judge"))?.version).toBe(2);

      calibration = (await evaluatorStore.list()).find((row) => row.id === judgeId)?.calibration;
      expect(calibration).toEqual({
        datasetName: "calib-set",
        experimentId: created.id,
        experimentName: "Calib",
        passed: true,
        questionSetName: "summary-questions",
        rate: 1,
        stale: false,
        targetAgreement: 0.9,
        version: 2,
      });
      expect((await evaluatorStore.get(questionSetId)).calibration).toBeUndefined();

      await evaluatorStore.update(questionSetId, {
        dimensions: [QUESTIONS[0], {...QUESTIONS[1], question: "Does it cover every todo?"}],
      });
      expect((await evaluatorStore.get(judgeId)).calibration?.stale).toBe(true);
      expect((await runner.get(created.id)).questionsStale).toBe(true);
    },
    SLOW_MONGO_TIMEOUT
  );

  it(
    "keeps prompt experiments free of agreement gates",
    async () => {
      await expect(
        runner.create({
          datasetId,
          evaluatorIds: [judgeId],
          name: "prompt run",
          promptName: "calib-judge",
          thresholds: [
            {
              aggregate: "agreement",
              dimension: "agreement",
              evaluatorName: "summary-judge",
              op: "gte",
              value: 0.9,
            },
          ],
          versions: [1, 2],
        })
      ).rejects.toThrow(/agreement gates belong to judge experiments/);
    },
    SLOW_MONGO_TIMEOUT
  );
});
