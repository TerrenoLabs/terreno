import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import type {RowScore, ScoreResult} from "../score/score";
import {diffRuns, type RunSnapshot} from "./diff";
import {runMatrix} from "./matrix";
import {listVersions} from "./versions";

const REGISTRY = ["57.4.2", "57.5.0", "58.0.0-beta.1", "58.0.0", "58.0.1", "58.0.6"];

const makeScore = (
  failing: string[] = [],
  times: Partial<ScoreResult["times"]> = {}
): ScoreResult => {
  const rows: RowScore[] = Array.from({length: 13}, (_, i) => {
    const row = `R${String(i + 1)}`;
    return {
      reason: failing.includes(row) ? "broken" : "ok",
      row,
      status: failing.includes(row) ? "FAIL" : "PASS",
    };
  });
  return {
    evidenceRefs: {ci: [], deploy: [], screenshots: []},
    pass: failing.length === 0,
    rows,
    times: {scoreMinutes: 0, stages: [], totalMinutes: 0, totalRegressed: false, ...times},
    version: "x",
    visualScore: 4,
  };
};

const snap = (version: string, over: Partial<RunSnapshot> = {}): RunSnapshot => ({
  files: [],
  iterations: 1,
  score: makeScore(),
  version,
  ...over,
});

describe("listVersions", () => {
  it("keeps stable 58+ ascending then local", () => {
    expect(listVersions(REGISTRY)).toEqual(["58.0.0", "58.0.1", "58.0.6", "local"]);
  });
  it("omits local with includeLocal false", () => {
    expect(listVersions(REGISTRY, {includeLocal: false})).toEqual(["58.0.0", "58.0.1", "58.0.6"]);
  });
  it("accepts the registry document shape and from-version", () => {
    const doc = {versions: Object.fromEntries(REGISTRY.map((v) => [v, {}]))};
    expect(listVersions(doc, {fromVersion: "58.0.1", includeLocal: false})).toEqual([
      "58.0.1",
      "58.0.6",
    ]);
  });
  it("rejects a from-version below the floor naming it", () => {
    expect(() => listVersions(REGISTRY, {fromVersion: "57.4.0"})).toThrow("58.0.0 floor");
  });
});

describe("diffRuns", () => {
  it("reports a PASS to FAIL row naming both versions", () => {
    const diff = diffRuns(snap("58.0.0"), snap("58.0.1", {score: makeScore(["R6"])}));
    expect(diff.rowRegressions).toEqual([
      {from: "58.0.0", reason: "broken", row: "R6", to: "58.0.1"},
    ]);
  });
  it("does not report a row that already failed", () => {
    const diff = diffRuns(
      snap("a", {score: makeScore(["R6"])}),
      snap("b", {score: makeScore(["R6"])})
    );
    expect(diff.rowRegressions).toEqual([]);
  });
  it("reports more iterations", () => {
    const diff = diffRuns(snap("a"), snap("b", {iterations: 3}));
    expect(diff.iterationRegressions).toEqual([{from: "a", now: 3, previous: 1, to: "b"}]);
  });
  it("reports removed files", () => {
    const diff = diffRuns(
      snap("a", {files: ["frontend/app/signup.tsx", "x"]}),
      snap("b", {files: ["x", "y"]})
    );
    expect(diff.removedFiles).toEqual(["frontend/app/signup.tsx"]);
  });
  it("reports stage and total time regressions", () => {
    const next = snap("b", {
      score: makeScore([], {
        previousTotal: 60,
        stages: [{id: "ai", previous: 10, regressed: true, totalMinutes: 13}],
        totalMinutes: 76,
        totalRegressed: true,
      }),
    });
    expect(diffRuns(snap("a"), next).timeRegressions).toEqual([
      {now: 13, previous: 10, scope: "ai"},
      {now: 76, previous: 60, scope: "total"},
    ]);
  });
});

describe("runMatrix", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bootstrap-loop-matrix-"));
  });
  afterEach(() => rmSync(root, {force: true, recursive: true}));

  it("runs exactly the given versions in order with the previous run dir and writes the report", async () => {
    const calls: {version: string; previousRunDir?: string}[] = [];
    const result = await runMatrix({
      outDir: join(root, "out"),
      runLoop: async ({version, runDir, previousRunDir}) => {
        calls.push({previousRunDir, version});
        mkdirSync(join(runDir, "app"), {recursive: true});
        writeFileSync(join(runDir, "app", version === "58.0.1" ? "b.txt" : "a.txt"), "x");
        writeFileSync(
          join(runDir, "score.json"),
          JSON.stringify(makeScore(version === "58.0.6" ? ["R6"] : []))
        );
        writeFileSync(join(runDir, "SCORE.md"), "s");
        return {iterations: [], pass: true};
      },
      versions: ["58.0.1", "58.0.6"],
      workRoot: join(root, "work"),
    });
    expect(calls.map((c) => c.version)).toEqual(["58.0.1", "58.0.6"]);
    expect(calls[0].previousRunDir).toBeUndefined();
    expect(calls[1].previousRunDir).toBe(join(root, "work", "58.0.1"));
    expect(result.diffs[0].rowRegressions[0].row).toBe("R6");
    const report = readFileSync(join(root, "out", "REGRESSIONS.md"), "utf8");
    expect(report).toContain("## 58.0.1 → 58.0.6");
    expect(report).toContain("Fixed at HEAD");
    expect(report).toContain("| Rubric row | R6 |");
    expect(readFileSync(join(root, "out", "runs", "58.0.1", "SCORE.md"), "utf8")).toBe("s");
  });
});
