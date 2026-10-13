import {describe, it} from "bun:test";
import {assert} from "chai";
import type {ExperimentRecord} from "./experimentTypes";
import {
  experimentProgressPercent,
  failingGateCount,
  gatesForVersion,
  isValidExperimentVersionCount,
  parsePromoteBlockedTitle,
  unwrapExperimentList,
  unwrapExperimentRecord,
  unwrapObservabilityPayload,
} from "./experimentTypes";

const experiment: ExperimentRecord = {
  created: "2026-01-01T00:00:00.000Z",
  datasetId: "ds-1",
  evaluatorIds: ["eval-1"],
  id: "exp-1",
  includeUnproofread: false,
  items: [],
  name: "compare",
  promptName: "summarize",
  results: {
    gates: [
      {
        actual: 0.5,
        aggregate: "trueRate",
        dimension: "correct",
        evaluatorName: "quality",
        op: "gte",
        passed: false,
        value: 0.8,
        version: 2,
      },
      {
        actual: 0.9,
        aggregate: "trueRate",
        dimension: "correct",
        evaluatorName: "quality",
        op: "gte",
        passed: true,
        value: 0.8,
        version: 1,
      },
    ],
    lowConfidenceItemIds: [],
    outlierItemIds: [],
    progress: {completed: 2, total: 4},
    totalCostUsd: 0.5,
  },
  status: "completed",
  thresholds: [],
  updated: "2026-01-01T00:05:00.000Z",
  versions: [1, 2],
};

describe("experimentTypes helpers", () => {
  it("unwraps experiment payloads", () => {
    assert.deepEqual(unwrapObservabilityPayload({data: experiment}), experiment);
    assert.deepEqual(unwrapExperimentList([experiment]), [experiment]);
    assert.deepEqual(unwrapExperimentList({data: [experiment]}), [experiment]);
    assert.deepEqual(unwrapExperimentRecord(experiment)?.id, "exp-1");
    assert.isUndefined(unwrapExperimentRecord({bad: true}));
  });

  it("counts failing gates and filters gates by version", () => {
    assert.equal(failingGateCount(experiment), 1);
    assert.equal(failingGateCount({...experiment, results: undefined}), 0);
    assert.equal(gatesForVersion(experiment, 2).length, 1);
    assert.equal(gatesForVersion(experiment, 3).length, 0);
  });

  it("computes progress percent with zero-safe denominator", () => {
    assert.equal(experimentProgressPercent(experiment), 50);
    assert.equal(
      experimentProgressPercent({
        ...experiment,
        results: {...experiment.results!, progress: {completed: 0, total: 0}},
      }),
      0
    );
  });

  it("parses promote blocked titles from 409 responses", () => {
    assert.equal(
      parsePromoteBlockedTitle({data: {status: 409, title: "Gate failed for v2"}}),
      "Gate failed for v2"
    );
    assert.isUndefined(parsePromoteBlockedTitle(null));
  });

  it("accepts only 2 or 3 selected prompt versions", () => {
    assert.isFalse(isValidExperimentVersionCount(0));
    assert.isFalse(isValidExperimentVersionCount(1));
    assert.isTrue(isValidExperimentVersionCount(2));
    assert.isTrue(isValidExperimentVersionCount(3));
    assert.isFalse(isValidExperimentVersionCount(4));
  });
});
