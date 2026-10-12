import {describe, it} from "bun:test";
import {
  LocalDatasetStore,
  LocalEvaluatorStore,
  LocalExperimentRunner,
  LocalPromptStore,
  LocalReviewStore,
} from "@terreno/ai";
import {assert} from "chai";
import mongoose from "mongoose";
import {adminScripts} from "../adminScripts";
import {seedDefaultData} from "./seed-test-data";
import {
  CHAT_DATASET_NAME,
  CHAT_EXPERIMENT,
  createSeedFixtureClient,
  JOKE_DATASET_NAME,
  JOKE_EXPERIMENT,
  SEED_FIXTURE_MODEL_ID,
  SUMMARIZE_EXPERIMENT_V1_V2,
  SUMMARIZE_EXPERIMENT_V2_V3,
  SUMMARIZE_GOLD_DATASET_NAME,
  seedAiObservabilityDemo,
} from "./seedAiObservabilityDemo";

const buildRunner = (promptStore: LocalPromptStore): LocalExperimentRunner => {
  const datasetStore = new LocalDatasetStore(promptStore);
  const evaluatorStore = new LocalEvaluatorStore(promptStore);
  return new LocalExperimentRunner({datasetStore, evaluatorStore, promptStore});
};

const gate = (
  gates: Array<{dimension: string; passed: boolean; version: number}>,
  version: number,
  dimension: string
): boolean | undefined => {
  return gates.find((row) => {
    return row.version === version && row.dimension === dimension;
  })?.passed;
};

describe("seedAiObservabilityDemo", () => {
  it("fills every observability screen and stays idempotent", async () => {
    await seedDefaultData();
    await seedAiObservabilityDemo({dryRun: false});

    const promptStore = new LocalPromptStore();
    const summarize = (await promptStore.list({search: "example-summarize"})).find((entry) => {
      return entry.name === "example-summarize";
    });
    assert.equal(summarize?.latestVersion, 3);
    assert.equal(summarize?.production, 1);
    assert.equal(
      (await promptStore.get({label: "staging", name: "example-summarize"}))?.version,
      3
    );

    for (const name of ["joke-generator", "chat-assistant"]) {
      const registered = await promptStore.get({name});
      assert.equal(registered?.version, 1, name);
      assert.equal((await promptStore.get({label: "staging", name}))?.version, 2, name);
    }
    assert.match((await promptStore.get({name: "joke-generator"}))?.body ?? "", /witty comedian/);

    const evaluatorNames = (await new LocalEvaluatorStore().list()).map((row) => row.name);
    assert.includeMembers(evaluatorNames, [
      "correctness",
      "correctness-human",
      "helpfulness",
      "helpfulness-human",
      "schema-assert",
    ]);

    const dataset = (await new LocalDatasetStore(promptStore).list()).find((entry) => {
      return entry.name === SUMMARIZE_GOLD_DATASET_NAME;
    });
    assert.equal(dataset?.counts.total, 10);
    assert.equal(dataset?.counts.needsReview, 2);

    const datasets = await new LocalDatasetStore(promptStore).list();
    for (const name of [JOKE_DATASET_NAME, CHAT_DATASET_NAME]) {
      assert.equal(datasets.find((entry) => entry.name === name)?.counts.total, 6, name);
    }

    const runner = buildRunner(promptStore);
    const experiments = (await runner.list({promptName: "example-summarize"})).data;
    const goldRun = experiments.find((row) => row.name === SUMMARIZE_EXPERIMENT_V1_V2);
    const lengthRun = experiments.find((row) => row.name === SUMMARIZE_EXPERIMENT_V2_V3);
    if (!goldRun?.results || !lengthRun?.results) {
      assert.fail("Seeded experiments did not finish");
    }
    assert.equal(goldRun.status, "completed");
    assert.deepEqual(goldRun.results.progress, {completed: 8, total: 8});
    assert.isFalse(gate(goldRun.results.gates, 1, "correct"));
    assert.isTrue(
      goldRun.results.gates.filter((row) => row.version === 2).every((row) => row.passed)
    );
    assert.isNotEmpty(goldRun.results.lowConfidenceItemIds);
    assert.isFalse(gate(lengthRun.results.gates, 3, "schema_valid"));
    assert.lengthOf(
      (await runner.get(lengthRun.id)).items.filter((item) => item.failed),
      2
    );

    for (const name of [JOKE_EXPERIMENT, CHAT_EXPERIMENT]) {
      const run = (await runner.list({limit: 100})).data.find((row) => row.name === name);
      if (!run?.results) {
        assert.fail(`${name} did not finish`);
      }
      assert.isFalse(gate(run.results.gates, 1, "helpfulness"), name);
      assert.isTrue(
        run.results.gates.filter((row) => row.version === 2).every((row) => row.passed),
        name
      );
    }

    const ObsTrace = mongoose.model("ObsTrace");
    assert.equal(await ObsTrace.countDocuments({sessionId: /^seed-obs-/}), 30);
    for (const name of ["joke-generator", "chat-assistant"]) {
      assert.equal(await ObsTrace.countDocuments({"prompts.name": name}), 6, name);
    }
    assert.equal(await ObsTrace.countDocuments({sessionId: /^seed-obs-/, status: "error"}), 2);

    const {counts} = await new LocalReviewStore().list();
    assert.deepEqual(counts, {done: 3, in_progress: 1, pending: 9, skipped: 1});

    await seedAiObservabilityDemo({dryRun: false});
    assert.equal(await ObsTrace.countDocuments({sessionId: /^seed-obs-/}), 30);
    assert.lengthOf((await runner.list({limit: 100})).data, 4);
    assert.deepEqual((await new LocalReviewStore().list()).counts, counts);
  });

  it("writes nothing on a dry run", async () => {
    await seedDefaultData();
    const ObsTrace = mongoose.model("ObsTrace");
    await ObsTrace.deleteMany({});

    const preview = await seedAiObservabilityDemo({dryRun: true});

    assert.equal(await ObsTrace.countDocuments({}), 0);
    assert.isTrue(
      preview.changes.some((change) => {
        return change.model === "ObsTrace" && change.change === "created";
      })
    );
  });

  it("answers summaries and judge calls deterministically", async () => {
    const client = createSeedFixtureClient();
    assert.equal(client.modelId, SEED_FIXTURE_MODEL_ID);
    const fallback = await client.generateText({
      prompt: "Summarize the following text:\n\nUnseen row.",
    });
    assert.equal(fallback, "Unseen row.");
    const verdict = await client.generateJsonObject<{correct: boolean}>({
      prompt: 'Model output JSON:\n"unknown"',
      schema: {} as never,
      schemaName: "correctness-judge",
    });
    assert.isTrue(verdict.correct);
  });

  it("is registered as an admin script", () => {
    const script = adminScripts.find(({name}) => name === "seedAiObservabilityDemo");
    assert.match(script?.description ?? "", /example-summarize-gold/);
  });
});
