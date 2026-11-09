import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {LocalEvaluatorStore} from "./evaluatorStore";
import {createLocalObservabilityPlugin} from "./localPlugin";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsReviewItem} from "./models/obsReviewItem";
import {registerObsTrace} from "./models/obsTrace";
import {LocalReviewStore} from "./reviewStore";
import {LocalTraceStore, MemoryScoreSink} from "./traceStore";

describe("LocalReviewStore", () => {
  let reviewStore: LocalReviewStore;
  let evaluatorId: string;
  let traceId: string;
  let scoreSink: MemoryScoreSink;

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    scoreSink = new MemoryScoreSink();
    const plugin = createLocalObservabilityPlugin();
    plugin.scoreSink = scoreSink;
    new ObservabilityApp({plugins: [plugin]});
    reviewStore = new LocalReviewStore();
    await registerObsReviewItem().deleteMany({});
    await registerObsEvaluator().deleteMany({});
    await registerObsTrace().deleteMany({});

    const evaluator = await new LocalEvaluatorStore().create({
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      instructions: "Pass if correct.",
      name: "correctness-review",
      target: "full trace",
      type: "human",
    });
    evaluatorId = evaluator.id;
    const exported = await new LocalTraceStore().exportTrace({
      id: "t",
      input: {raw: "prompt text"},
      name: "gen",
      output: {raw: "model text"},
      prompts: [],
      sensitive: false,
      spans: [
        {
          id: "s",
          kind: "LLM",
          name: "llm",
          startedAt: DateTime.utc().toISO() ?? "",
          status: "ok",
        },
      ],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
    });
    traceId = exported.id;
  });

  it("submits scores, hides the item from pending, and falls back panel keys", async () => {
    const [item] = await reviewStore.enqueue({
      evaluatorId,
      reason: "manual",
      traceIds: [traceId],
    });
    const detail = await reviewStore.getDetail(item.id);
    expect(item.traceName).toBe("gen");
    expect(detail.rawInput).toEqual({raw: "prompt text"});
    expect(detail.rawOutput).toEqual({raw: "model text"});
    expect(detail.panels.given[0]?.key).toBe("raw");
    expect(detail.panels.wrote[0]?.key).toBe("raw");

    await expect(
      reviewStore.submit({
        id: item.id,
        scores: {},
        sinks: [scoreSink],
      })
    ).rejects.toMatchObject({status: 400, title: 'Score "correct" is required'});

    await reviewStore.submit({
      comment: "looks good",
      id: item.id,
      scores: {correct: true},
      sinks: [scoreSink],
    });
    expect(scoreSink.scores[0]?.name).toBe("correct");
    expect(scoreSink.scores[0]?.value).toBe(true);

    const pending = await reviewStore.list("pending");
    expect(pending.data.map((row) => row.id)).not.toContain(item.id);
    expect(pending.counts.done).toBe(1);

    const other = (
      await reviewStore.enqueue({evaluatorId, reason: "manual", traceIds: [traceId]})
    )[0];
    await reviewStore.skip(other.id);
    const skipped = await reviewStore.list("skipped");
    expect(skipped.data.map((row) => row.id)).toContain(other.id);

    const assigned = (
      await reviewStore.enqueue({evaluatorId, reason: "manual", traceIds: [traceId]})
    )[0];
    await reviewStore.assign(assigned.id, new mongoose.Types.ObjectId().toString());
    const inProgress = await reviewStore.list("in_progress");
    expect(inProgress.data.map((row) => row.id)).toContain(assigned.id);
  });

  it("rejects automatic evaluators from the human review queue", async () => {
    const automatic = await new LocalEvaluatorStore().create({
      assertion: {constraint: "exists", path: "output"},
      dimensions: [{dataType: "boolean", key: "valid", required: true}],
      name: "automatic-schema-check",
      target: "full trace",
      type: "json-assert",
    });

    try {
      await reviewStore.enqueue({
        evaluatorId: automatic.id,
        reason: "manual",
        traceIds: [traceId],
      });
      assert.fail("Expected human-review enqueue to reject an automatic evaluator");
    } catch (error) {
      assert.deepInclude(error as object, {
        status: 400,
        title: "Human review requires a human evaluator",
      });
    }
  });

  it("skips blank optional dimensions and stores scores without configured sinks", async () => {
    const optionalEvaluator = await new LocalEvaluatorStore().create({
      dimensions: [
        {dataType: "boolean", key: "correct", required: true},
        {dataType: "categorical", key: "failureMode", required: false},
      ],
      name: "optional-human-score",
      target: "full trace",
      type: "human",
    });
    const [item] = await reviewStore.enqueue({
      evaluatorId: optionalEvaluator.id,
      reason: "manual",
      traceIds: [traceId],
    });

    await reviewStore.submit({
      id: item.id,
      scores: {correct: true},
      sinks: [],
    });

    const trace = await new LocalTraceStore().getDetail(traceId);
    assert.deepInclude(trace.scores[0], {name: "correct", value: true});
    assert.lengthOf(trace.scores, 1);
    assert.equal((await reviewStore.getDetail(item.id)).status, "done");
  });
});
