import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import {EVALUATOR_TEMPLATES} from "../evaluatorTemplates";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {LocalEvaluatorStore} from "./evaluatorStore";
import {createLocalObservabilityPlugin} from "./localPlugin";
import {registerObsEvaluator} from "./models/obsEvaluator";

describe("LocalEvaluatorStore", () => {
  let store: LocalEvaluatorStore;

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]});
    store = new LocalEvaluatorStore();
    await registerObsEvaluator().deleteMany({});
  });

  it("persists numeric, boolean, and categorical dimensions", async () => {
    const created = await store.create({
      dimensions: [
        {dataType: "numeric", key: "helpfulness", range: "0-1", required: true},
        {dataType: "boolean", key: "correct", required: true},
        {dataType: "categorical", key: "tone", range: "warm|neutral|cold", required: false},
      ],
      instructions: "Score the generation.",
      name: "review-pack",
      runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
      target: "full trace",
      type: "human",
    });
    const loaded = await store.get(created.id);
    expect(loaded.dimensions.map((row) => row.dataType)).toEqual([
      "numeric",
      "boolean",
      "categorical",
    ]);
    expect(loaded.confidenceAlertBelow).toBe(0.7);
  });

  it("rejects a human evaluator with live sampling", async () => {
    await expect(
      store.create({
        dimensions: [{dataType: "boolean", key: "correct", required: true}],
        name: "live-human",
        runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 5},
        target: "generation span",
        type: "human",
      })
    ).rejects.toThrow(/liveSampleRate/);
  });

  it("installs a seeded template by name", async () => {
    expect(EVALUATOR_TEMPLATES.some((row) => row.name === "correctness-human")).toBe(true);
    const installed = await store.installTemplate("correctness-human");
    expect(installed.name).toBe("correctness-human");
    expect(installed.type).toBe("human");
    expect(installed.dimensions[0]?.dataType).toBe("boolean");
  });

  it("supports evaluator CRUD, lookup, and validation errors", async () => {
    const created = await store.create({
      assertion: {constraint: "exists", path: "answer"},
      confidenceAlertBelow: 0.5,
      description: "Checks answers",
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      instructions: "Score it",
      name: "answer-check",
      target: "generation span",
      type: "json-assert",
    });
    const listed = await store.list();
    assert.equal(
      listed.some((row) => row.id === created.id),
      true
    );
    assert.equal((await store.get(created.id)).name, created.name);
    assert.equal((await store.getByName("answer-check"))?.id, created.id);

    const updated = await store.update(created.id, {description: "Updated"});
    assert.equal(updated.description, "Updated");
    await store.remove(created.id);

    try {
      await store.get(created.id);
      assert.fail("expected deleted evaluator to 404");
    } catch (error) {
      assert.match(String(error), /Unknown evaluator/);
    }

    try {
      await store.create({
        dimensions: [],
        name: "missing-fields",
        target: "full trace",
        type: "human",
      });
      assert.fail("expected missing fields rejection");
    } catch (error) {
      assert.match(String(error), /name and dimensions/);
    }

    try {
      await store.create({
        dimensions: [{dataType: "boolean", key: "correct", required: true}],
        judgePromptName: "missing-judge",
        name: "bad-judge",
        target: "generation span",
        type: "llm-judge",
      });
      assert.fail("expected unknown judge prompt rejection");
    } catch (error) {
      assert.match(String(error), /Unknown judge prompt/);
    }

    try {
      await store.create({
        dimensions: [{dataType: "boolean", key: "correct", required: true}],
        name: "bad-assert",
        target: "generation span",
        type: "json-assert",
      });
      assert.fail("expected json-assert path rejection");
    } catch (error) {
      assert.match(String(error), /assertion.path/);
    }

    try {
      await store.installTemplate("missing-template");
      assert.fail("expected unknown template rejection");
    } catch (error) {
      assert.match(String(error), /Unknown evaluator template/);
    }
  });
});
