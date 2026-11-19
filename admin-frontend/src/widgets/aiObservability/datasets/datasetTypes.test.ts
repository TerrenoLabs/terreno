import {describe, it} from "bun:test";
import {assert} from "chai";
import type {DatasetItemRecord, DatasetRecord} from "./datasetTypes";
import {
  filterDatasetItemsByTab,
  nextNeedsReviewItemId,
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

describe("nextNeedsReviewItemId", () => {
  const queue = [
    item({id: "a", proofread: false}),
    item({id: "b", proofread: true}),
    item({id: "c", proofread: false}),
    item({id: "d", proofread: false}),
  ];

  it("returns the next unproofread item after the current one in list order", () => {
    assert.equal(nextNeedsReviewItemId(queue, "a"), "c");
    assert.equal(nextNeedsReviewItemId(queue, "c"), "d");
  });

  it("wraps to the top when nothing after the current item needs review", () => {
    assert.equal(nextNeedsReviewItemId(queue, "d"), "a");
  });

  it("never returns the current item, even when it is the only one left", () => {
    assert.isUndefined(nextNeedsReviewItemId([item({id: "a", proofread: false})], "a"));
  });

  it("returns undefined when every item is proofread", () => {
    assert.isUndefined(nextNeedsReviewItemId([item({id: "a"}), item({id: "b"})], "a"));
  });

  it("returns the first queued item when the current id is unknown", () => {
    assert.equal(nextNeedsReviewItemId(queue, "missing"), "a");
  });
});
