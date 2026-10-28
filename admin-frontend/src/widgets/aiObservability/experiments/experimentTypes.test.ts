import {describe, it} from "bun:test";
import {assert} from "chai";
import type {ExperimentRecord, VersionGateSummary} from "./experimentTypes";
import {
  experimentItemColumnWidths,
  failingGateCount,
  formatGateActual,
  formatGateName,
  formatGateThreshold,
  formatPromoteBlockedReason,
  formatVersionGateVerdict,
  isValidExperimentVersionCount,
  parsePromoteBlockedTitle,
  summarizeGatesByVersion,
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

const summaryFor = (version: number): VersionGateSummary => {
  const summary = summarizeGatesByVersion(experiment).find((entry) => entry.version === version);
  if (!summary) {
    throw new Error(`No gate summary for v${version}`);
  }
  return summary;
};

describe("experimentTypes helpers", () => {
  it("unwraps experiment payloads", () => {
    assert.deepEqual(unwrapObservabilityPayload({data: experiment}), experiment);
    assert.deepEqual(unwrapExperimentList([experiment]), [experiment]);
    assert.deepEqual(unwrapExperimentList({data: [experiment]}), [experiment]);
    assert.deepEqual(unwrapExperimentRecord(experiment)?.id, "exp-1");
    assert.isUndefined(unwrapExperimentRecord({bad: true}));
  });

  it("counts failing gates and groups gates by version", () => {
    assert.equal(failingGateCount(experiment), 1);
    assert.equal(failingGateCount({...experiment, results: undefined}), 0);
    assert.equal(summaryFor(2).gates.length, 1);
    assert.deepEqual(
      summarizeGatesByVersion({...experiment, versions: [3]}).map((summary) => summary.gates),
      [[]]
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

  it("stretches output columns to fill the measured table width", () => {
    assert.deepEqual(experimentItemColumnWidths({containerWidth: 1200, versionCount: 2}), {
      item: 120,
      output: 460,
      pass: 80,
    });
    assert.equal(experimentItemColumnWidths({containerWidth: 1200, versionCount: 3}).output, 280);
  });

  it("keeps output columns readable when the table is narrow or unmeasured", () => {
    assert.equal(experimentItemColumnWidths({containerWidth: 0, versionCount: 2}).output, 180);
    assert.equal(experimentItemColumnWidths({containerWidth: 500, versionCount: 3}).output, 180);
  });

  it("shows gate operators as symbols, never API words", () => {
    assert.equal(formatGateThreshold({op: "gte", value: 0.8}), "≥ 0.8");
    assert.equal(formatGateThreshold({op: "lte", value: 0.2}), "≤ 0.2");
    assert.equal(formatGateThreshold({op: "gt" as never, value: 1}), "> 1");
    assert.equal(formatGateThreshold({op: "lt" as never, value: 1}), "< 1");
    assert.equal(formatGateThreshold({op: "eq", value: 1}), "= 1");
  });

  it("names gates in plain words without repeating a shared name", () => {
    assert.equal(
      formatGateName({dimension: "helpfulness", evaluatorName: "helpfulness"}),
      "helpfulness"
    );
    assert.equal(
      formatGateName({dimension: "correct", evaluatorName: "correctness"}),
      "correctness: correct"
    );
    assert.equal(
      formatGateName({dimension: "schema_valid", evaluatorName: "schema-assert"}),
      "schema-assert: schema valid"
    );
  });

  it("formats measured values", () => {
    assert.equal(formatGateActual(0.625), "0.63");
    assert.equal(formatGateActual(undefined), "—");
  });

  it("summarizes gates per version in version order", () => {
    const summaries = summarizeGatesByVersion(experiment);
    assert.deepEqual(
      summaries.map((summary) => [summary.version, summary.passed, summary.failing.length]),
      [
        [1, true, 0],
        [2, false, 1],
      ]
    );
    assert.equal(formatVersionGateVerdict(summaryFor(1)), "Passes its gate");
    assert.equal(formatVersionGateVerdict(summaryFor(2)), "Fails 1 of 1 gate");
    assert.equal(
      formatVersionGateVerdict({failing: [], gates: [], passed: false, version: 3}),
      "No gates"
    );
  });

  it("explains which gates block promoting a version, with correct plurals", () => {
    const failing = summaryFor(2);
    assert.isUndefined(formatPromoteBlockedReason(summaryFor(1)));
    assert.equal(
      formatPromoteBlockedReason(failing),
      "v2 fails 1 gate: quality: correct ≥ 0.8 (got 0.50) — can't promote v2."
    );
    const [gate] = failing.gates;
    if (!gate) {
      throw new Error("Expected a v2 gate");
    }
    const twoFailing: VersionGateSummary = {
      failing: [gate, {...gate, dimension: "helpfulness", evaluatorName: "helpfulness"}],
      gates: [gate],
      passed: false,
      version: 2,
    };
    assert.equal(
      formatPromoteBlockedReason(twoFailing),
      "v2 fails 2 gates: quality: correct ≥ 0.8 (got 0.50); helpfulness ≥ 0.8 (got 0.50) — can't promote v2."
    );
  });
});
