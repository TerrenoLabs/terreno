import {describe, it} from "bun:test";
import {assert} from "chai";
import type {DatasetItemRecord, DatasetRecord} from "./datasetTypes";
import {
  filterDatasetItemsByTab,
  formatProvenanceBar,
  summarizeJson,
  unwrapDatasetItems,
  unwrapDatasetList,
  unwrapDatasetRecord,
} from "./datasetTypes";

const dataset: DatasetRecord = {
  counts: {auto: 2, human: 1, needsReview: 1, total: 3},
  created: "2026-01-01T00:00:00.000Z",
  id: "ds-1",
  name: "gold",
  tags: [],
  updated: "2026-01-02T00:00:00.000Z",
};

const item = (partial: Partial<DatasetItemRecord> & {id: string}): DatasetItemRecord => ({
  created: "2026-01-01T00:00:00.000Z",
  datasetId: "ds-1",
  id: partial.id,
  input: {q: "hi"},
  origin: "manual",
  proofread: true,
  tags: [],
  updated: "2026-01-01T00:00:00.000Z",
  ...partial,
});

describe("datasetTypes helpers", () => {
  it("unwraps dataset lists and filters invalid rows", () => {
    assert.deepEqual(unwrapDatasetList([dataset]), [dataset]);
    assert.deepEqual(unwrapDatasetList({data: [dataset]}), [dataset]);
    assert.deepEqual(unwrapDatasetList([{name: "bad"}]), []);
    assert.deepEqual(unwrapDatasetList(undefined), []);
  });

  it("unwraps a single dataset record", () => {
    assert.deepEqual(unwrapDatasetRecord(dataset)?.id, "ds-1");
    assert.deepEqual(unwrapDatasetRecord({data: dataset})?.id, "ds-1");
    assert.isUndefined(unwrapDatasetRecord({name: "missing id"}));
  });

  it("unwraps dataset items", () => {
    const rows = [item({id: "i-1"})];
    assert.deepEqual(unwrapDatasetItems(rows), rows);
    assert.deepEqual(unwrapDatasetItems({data: rows}), rows);
    assert.deepEqual(unwrapDatasetItems([{bad: true}]), []);
  });

  it("formats provenance bar and handles empty totals", () => {
    assert.equal(formatProvenanceBar({auto: 0, human: 0, needsReview: 0, total: 0}), "—");
    assert.equal(
      formatProvenanceBar({auto: 2, human: 1, needsReview: 0, total: 3}),
      "33% human · 67% auto"
    );
    assert.equal(
      formatProvenanceBar({auto: 1, human: 1, needsReview: 0, total: 1}),
      "100% human · 0% auto"
    );
  });

  it("filters items by tab", () => {
    const items = [
      item({id: "human", proofread: true}),
      item({id: "auto", origin: "trace", proofread: false}),
      item({id: "review", origin: "manual", proofread: false}),
    ];
    assert.equal(filterDatasetItemsByTab(items, "all").length, 3);
    assert.deepEqual(
      filterDatasetItemsByTab(items, "human").map((row) => row.id),
      ["human"]
    );
    assert.deepEqual(
      filterDatasetItemsByTab(items, "auto").map((row) => row.id),
      ["auto"]
    );
    assert.deepEqual(
      filterDatasetItemsByTab(
        [...items, item({id: "reviewed-trace", origin: "trace", proofread: true})],
        "auto"
      ).map((row) => row.id),
      ["auto"]
    );
    assert.deepEqual(
      filterDatasetItemsByTab(items, "needsReview").map((row) => row.id),
      ["auto", "review"]
    );
  });

  it("summarizes json values with truncation", () => {
    assert.equal(summarizeJson(null), "—");
    assert.equal(summarizeJson("short"), "short");
    const long = "x".repeat(90);
    assert.equal(summarizeJson(long).endsWith("…"), true);
    assert.equal(summarizeJson({a: 1}).length <= 80, true);
  });
});
