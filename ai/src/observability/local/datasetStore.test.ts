import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import {DateTime} from "luxon";

import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {LocalDatasetStore, throwOnDatasetImportErrors} from "./datasetStore";
import {createLocalObservabilityBundle} from "./localPlugin";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsTrace} from "./models/obsTrace";
import {LocalPromptStore} from "./promptStore";

describe("LocalDatasetStore", () => {
  let store: LocalDatasetStore;
  let promptStore: LocalPromptStore;

  beforeEach(async () => {
    createLocalObservabilityBundle();
    promptStore = new LocalPromptStore();
    store = new LocalDatasetStore(promptStore);
    await registerObsDataset().deleteMany({});
    await registerObsDatasetItem().deleteMany({});
    await registerObsTrace().deleteMany({});
    new ObservabilityApp({plugins: [createLocalObservabilityBundle().plugin]});
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  it("imports JSON rows and validates bound input schemas", async () => {
    await promptStore.create({
      folder: "examples",
      inputSchema: {
        properties: {text: {type: "string"}},
        required: ["text"],
        type: "object",
      },
      name: "bound-prompt",
      type: "text",
    });
    await promptStore.moveLabel("bound-prompt", {label: "production", version: 1});
    const dataset = await store.create({
      inputSchemaPromptName: "bound-prompt",
      name: "gold",
    });
    const ok = await store.importJson(dataset.id, [{text: "hello"}]);
    assert.equal(ok.created, 1);
    try {
      await store.createItem(dataset.id, {input: {text: 123}});
      assert.fail("expected schema failure");
    } catch (error) {
      assert.match(String(error), /\/text/);
    }
  });

  it("keeps reserved metadata fields out of a flat JSON row input", async () => {
    const dataset = await store.create({name: "flat-json"});
    const result = await store.importJson(dataset.id, [
      {proofread: true, tags: ["gold"], text: "hello"},
    ]);

    assert.equal(result.created, 1);
    const items = await store.listItems(dataset.id);
    assert.deepEqual(items[0]?.input, {text: "hello"});
    assert.equal(items[0]?.proofread, true);
    assert.deepEqual(items[0]?.tags, ["gold"]);
  });

  it("imports quoted CSV rows with nested input columns", async () => {
    const dataset = await store.create({name: "csv-set"});
    const csv = [
      "input.text,expectedOutput.answer,proofread,tags",
      '"hello, world","4",false,"gold|edge"',
    ].join("\n");
    const result = await store.importCsv(dataset.id, csv);
    assert.equal(result.created, 1);
    const items = await store.listItems(dataset.id);
    assert.deepEqual(items[0]?.input, {text: "hello, world"});
    assert.deepEqual(items[0]?.expectedOutput, {answer: 4});
    assert.equal(items[0]?.proofread, false);
    assert.deepEqual(items[0]?.tags, ["gold", "edge"]);
  });

  it("forces sensitive traces to proofread false and keeps sourceTraceId", async () => {
    const dataset = await store.create({name: "trace-set"});
    const trace = await registerObsTrace().create({
      input: {text: "secret"},
      name: "sensitive-trace",
      output: {answer: "hidden"},
      prompts: [],
      sensitive: true,
      startedAt: DateTime.utc().toJSDate(),
      status: "ok",
    });
    const [item] = await store.addTracesToDataset({
      datasetId: dataset.id,
      traceIds: [String(trace._id)],
    });
    assert.equal(item.proofread, false);
    assert.equal(item.sourceTraceId, String(trace._id));
    await store.removeItem(dataset.id, item.id);
    const reloaded = await registerObsTrace().findOneOrNone({_id: trace._id});
    assert.isOk(reloaded);
    assert.equal(reloaded?.sensitive, true);
  });

  it("includes human/auto/needsReview counts on list and detail", async () => {
    const dataset = await store.create({name: "counts"});
    await store.createItem(dataset.id, {input: {a: 1}, proofread: true});
    await store.createItem(dataset.id, {input: {a: 2}, proofread: false});
    await store.createItem(dataset.id, {
      input: {a: 3},
      origin: "synthetic",
      proofread: false,
    });
    await store.createItem(dataset.id, {
      input: {a: 4},
      origin: "trace",
      proofread: true,
    });
    const detail = await store.get(dataset.id);
    assert.equal(detail.counts.total, 4);
    assert.equal(detail.counts.human, 2);
    assert.equal(detail.counts.auto, 1);
    assert.equal(detail.counts.needsReview, 2);
    const listed = await store.list();
    assert.equal(
      listed.some((row) => row.id === dataset.id),
      true
    );
  });

  it("supports dataset CRUD, duplicate protection, and item updates", async () => {
    const created = await store.create({
      description: "gold",
      expectedOutputSchema: {type: "string"},
      inputSchemaPromptName: "prompt",
      name: "crud-set",
      tags: ["a"],
    });
    const updated = await store.update(created.id, {description: "updated", name: "crud-set"});
    assert.equal(updated.description, "updated");

    try {
      await store.create({name: "crud-set"});
      assert.fail("expected duplicate dataset rejection");
    } catch (error) {
      assert.match(String(error), /already exists/);
    }

    const item = await store.createItem(created.id, {
      input: {text: "one"},
      metadata: {source: "seed"},
      proofread: false,
      tags: ["gold"],
    });
    const saved = await store.updateItem(created.id, item.id, {
      input: {text: "two"},
      proofread: true,
      tags: ["reviewed"],
    });
    assert.deepEqual(saved.input, {text: "two"});
    assert.equal(saved.proofread, true);
    const clearedDataset = await store.update(created.id, {
      description: null,
      expectedOutputSchema: null,
      inputSchemaPromptName: null,
    });
    assert.isUndefined(clearedDataset.description);
    assert.isUndefined(clearedDataset.expectedOutputSchema);
    assert.isUndefined(clearedDataset.inputSchemaPromptName);
    const clearedItem = await store.updateItem(created.id, item.id, {
      expectedOutput: null,
      metadata: null,
      outcomeClass: null,
    });
    assert.isUndefined(clearedItem.expectedOutput);
    assert.isUndefined(clearedItem.metadata);
    assert.isUndefined(clearedItem.outcomeClass);

    await store.removeItem(created.id, item.id);
    await store.remove(created.id);
    try {
      await store.get(created.id);
      assert.fail("expected deleted dataset to 404");
    } catch (error) {
      assert.match(String(error), /Unknown dataset/);
    }
  });

  it("wraps import validation errors and supports single-trace adds", async () => {
    await promptStore.create({
      folder: "examples",
      inputSchema: {
        properties: {text: {type: "string"}},
        required: ["text"],
        type: "object",
      },
      name: "import-bound",
      type: "text",
    });
    await promptStore.moveLabel("import-bound", {label: "production", version: 1});
    const dataset = await store.create({
      inputSchemaPromptName: "import-bound",
      name: "import-errors",
    });
    const failed = await store.importJson(dataset.id, [{text: 123}]);
    try {
      throwOnDatasetImportErrors(failed);
      assert.fail("expected import validation throw");
    } catch (error) {
      assert.match(String(error), /Import failed on row/);
    }

    const trace = await registerObsTrace().create({
      input: {text: "trace"},
      name: "trace-add",
      output: {answer: "ok"},
      prompts: [],
      startedAt: DateTime.utc().toJSDate(),
      status: "ok",
    });
    const single = await store.addTraceToDataset({
      datasetId: dataset.id,
      traceId: String(trace._id),
    });
    assert.equal(single.sourceTraceId, String(trace._id));
  });
});
