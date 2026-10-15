import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";

import type {EvaluatorAiClient} from "../evaluate";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {LocalEvaluatorStore} from "./evaluatorStore";
import {createLocalObservabilityPlugin} from "./localPlugin";
import {registerObsEvaluator} from "./models/obsEvaluator";
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

const QUESTIONS = [
  {dataType: "boolean" as const, key: "faithful", question: "Is it faithful?", required: true},
  {dataType: "boolean" as const, key: "complete", question: "Is it complete?", required: true},
];

const exportTrace = async (params: {
  hoursAgo: number;
  output?: string;
  prompt: string;
  status?: "error" | "ok";
}): Promise<string> => {
  const startedAt = DateTime.utc().minus({hours: params.hoursAgo}).toISO() ?? "";
  const exported = await new LocalTraceStore().exportTrace({
    id: `t-${params.hoursAgo}`,
    input: `input ${params.hoursAgo}`,
    name: params.prompt,
    output: params.output,
    prompts: [{name: params.prompt, version: 1}],
    sensitive: false,
    spans: [{id: "s", kind: "LLM", name: "llm", startedAt, status: params.status ?? "ok"}],
    startedAt,
    status: params.status ?? "ok",
  });
  return exported.id;
};

// Judge that answers "faithful" from the output text and always says "complete".
const fakeJudge: EvaluatorAiClient & {modelId: string} = {
  generateJsonObject: async <OBJECT>(options: {prompt: string}) => {
    return {complete: true, confidence: 0.9, faithful: !options.prompt.includes("bad")} as OBJECT;
  },
  modelId: "fake-judge",
};

describe("LocalReviewBatchStore", () => {
  let promptStore: LocalPromptStore;
  let store: LocalReviewBatchStore;
  let questionSetId: string;
  let judgeId: string;

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
    ]) {
      await (model as unknown as {deleteMany: (filter: object) => Promise<unknown>}).deleteMany({});
    }
    promptStore = new LocalPromptStore();
    store = new LocalReviewBatchStore(promptStore);
    await promptStore.create({
      folder: "evaluators",
      name: "judge-questions",
      outputSchema: {
        properties: {
          complete: {type: "boolean"},
          confidence: {type: "number"},
          faithful: {type: "boolean"},
        },
        required: ["faithful", "complete"],
        type: "object",
      },
      system: "Answer each question.",
      type: "chat",
    });
    await promptStore.moveLabel("judge-questions", {label: "production", version: 1});
    const evaluators = new LocalEvaluatorStore(promptStore);
    questionSetId = (
      await evaluators.create({
        dimensions: QUESTIONS,
        name: "summary-questions",
        target: "full trace",
        type: "human",
      })
    ).id;
    judgeId = (
      await evaluators.create({
        dimensions: QUESTIONS.map(({question: _question, ...row}) => row),
        judgePromptName: "judge-questions",
        name: "summary-judge",
        target: "full trace",
        type: "llm-judge",
      })
    ).id;
  });

  it("builds a batch from the newest successful traces for a prompt", async () => {
    for (let hoursAgo = 1; hoursAgo <= 12; hoursAgo += 1) {
      await exportTrace({hoursAgo, output: `summary ${hoursAgo}`, prompt: "summarize"});
    }
    await exportTrace({hoursAgo: 0, prompt: "summarize", status: "error"});
    await exportTrace({hoursAgo: 0, output: "other", prompt: "jokes"});

    const batch = await store.create({evaluatorId: questionSetId, promptName: "summarize"});
    expect(batch.name).toBe("summarize — batch 1");
    expect(batch.counts).toEqual({done: 0, pending: 10, skipped: 0, total: 10});
    expect(batch.items.map((item) => item.output)).toEqual(
      Array.from({length: 10}, (_value, index) => `summary ${index + 1}`)
    );
    expect(batch.dimensions.map((row) => row.question)).toEqual([
      "Is it faithful?",
      "Is it complete?",
    ]);

    // A second batch skips traces already batched for this question set.
    const next = await store.create({evaluatorId: questionSetId, promptName: "summarize"});
    expect(next.items.map((item) => item.output)).toEqual(["summary 11", "summary 12"]);
    await expect(
      store.create({evaluatorId: questionSetId, promptName: "summarize"})
    ).rejects.toThrow(/No recent "summarize" traces/);

    const pending = await new LocalReviewStore().list("pending", {batchId: batch.id});
    expect(pending.data).toHaveLength(10);
    expect(pending.counts.pending).toBe(10);
    const detail = await new LocalReviewStore().getDetail(pending.data[0]?.id ?? "");
    expect(detail.batchName).toBe("summarize — batch 1");
  });

  it("rejects non-human question sets and out-of-range limits", async () => {
    await expect(store.create({evaluatorId: judgeId})).rejects.toThrow(/human evaluator/);
    await expect(store.create({evaluatorId: questionSetId, limit: 51})).rejects.toThrow(/limit/);
  });

  it("compares judge answers with human answers question by question", async () => {
    const good = await exportTrace({hoursAgo: 2, output: "good summary", prompt: "summarize"});
    const bad = await exportTrace({hoursAgo: 1, output: "bad summary", prompt: "summarize"});
    const batch = await store.create({
      evaluatorId: questionSetId,
      name: "Hand picked",
      traceIds: [good, bad],
    });
    const reviews = new LocalReviewStore();
    const [goodItem, badItem] = batch.items;
    await reviews.submit({
      id: goodItem?.reviewItemId ?? "",
      scores: {complete: true, faithful: true},
      sinks: [new MemoryScoreSink()],
    });
    await reviews.submit({
      id: badItem?.reviewItemId ?? "",
      scores: {complete: false, faithful: false},
      sinks: [new MemoryScoreSink()],
    });

    const judged = await store.runJudge({ai: fakeJudge, batchId: batch.id, evaluatorId: judgeId});
    expect(judged.judgeCount).toBe(1);
    const [summary] = judged.judges;
    expect(summary?.evaluatorName).toBe("summary-judge");
    expect(summary?.modelId).toBe("fake-judge");
    expect(summary?.agreement.rate).toBe(0.75);
    expect(summary?.agreement.questions.map((row) => row.rate)).toEqual([1, 0.5]);
    expect(summary?.agreement.disagreements).toEqual([
      {human: false, judge: true, key: "complete", traceId: bad},
    ]);
    expect(judged.items[1]?.judgeAnswers[judgeId]?.scores).toEqual({
      complete: true,
      faithful: false,
    });

    // Re-running keeps only the latest run per judge.
    await store.runJudge({ai: fakeJudge, batchId: batch.id, evaluatorId: judgeId});
    const listed = await store.list();
    expect(listed[0]?.judgeCount).toBe(1);
    expect(listed[0]?.bestJudge).toEqual({evaluatorName: "summary-judge", rate: 0.75});
    expect(listed[0]?.counts.done).toBe(2);
  });

  it("refuses judges that share no questions with the batch", async () => {
    await promptStore.create({
      folder: "evaluators",
      name: "judge-other",
      outputSchema: {properties: {tone: {type: "string"}}, required: ["tone"], type: "object"},
      type: "chat",
    });
    await promptStore.moveLabel("judge-other", {label: "production", version: 1});
    const other = await new LocalEvaluatorStore(promptStore).create({
      dimensions: [{dataType: "categorical", key: "tone", required: true}],
      judgePromptName: "judge-other",
      name: "tone-judge",
      target: "full trace",
      type: "llm-judge",
    });
    const trace = await exportTrace({hoursAgo: 1, output: "x", prompt: "summarize"});
    const batch = await store.create({evaluatorId: questionSetId, traceIds: [trace]});
    await expect(
      store.runJudge({ai: fakeJudge, batchId: batch.id, evaluatorId: other.id})
    ).rejects.toThrow(/answers none of this batch's questions/);
    await expect(
      store.runJudge({ai: fakeJudge, batchId: batch.id, evaluatorId: questionSetId})
    ).rejects.toThrow(/Only llm-judge/);
  });
});
