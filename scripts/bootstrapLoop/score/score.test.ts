import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import type {BuildResult} from "../build";
import type {EvidenceFile} from "./collectEvidence";
import {ROW_IDS} from "./collectEvidence";
import type {RowEvidence} from "./probes/probeKit";
import {scoreBuild} from "./score";
import {compareTimes, isTimeRegression} from "./timeRegression";

const FAKE_SCORER = join(import.meta.dir, "../fixtures/fakeScorer.ts");
let runDir = "";

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-score-"));
});
afterEach(() => {
  rmSync(runDir, {force: true, recursive: true});
});

const build = (stages: Record<string, number>, version = "58.0.6"): BuildResult => {
  const list = Object.entries(stages).map(([id, totalMinutes]) => ({
    attempts: 1,
    firstPassMinutes: totalMinutes,
    id,
    status: "PASS" as const,
    totalMinutes,
  }));
  return {
    endedAt: "2026-01-01T00:00:00.000Z",
    stages: list,
    startedAt: "2026-01-01T00:00:00.000Z",
    totalMinutes: list.reduce((sum, stage) => sum + stage.totalMinutes, 0),
    version,
  };
};

const evidence = (overrides: Record<string, Partial<RowEvidence>> = {}): EvidenceFile => ({
  rows: ROW_IDS.map((row) => ({
    artifacts: [],
    facts: [],
    row,
    status: "PASS" as const,
    ...overrides[row],
  })),
});

const seed = (stages: Record<string, number>, version = "58.0.6"): void => {
  mkdirSync(join(runDir, "stages"), {recursive: true});
  writeFileSync(join(runDir, "build.json"), JSON.stringify(build(stages, version)));
  // A builder log the scorer must never see.
  writeFileSync(
    join(runDir, "stages", "ai.json"),
    JSON.stringify({log: "BUILDER-TRANSCRIPT-MARKER", stage: "ai"})
  );
};

const score = (
  options: {mode?: string; evidence?: EvidenceFile; previousDir?: string; record?: string} = {}
) =>
  scoreBuild({
    collect: async ({runDir: dir}) => {
      const file = options.evidence ?? evidence();
      mkdirSync(join(dir, "evidence"), {recursive: true});
      writeFileSync(join(dir, "evidence", "evidence.json"), JSON.stringify(file));
      return file;
    },
    env: {
      ...process.env,
      BOOTSTRAP_LOOP_FAKE_SCORER_MODE: options.mode ?? "agree",
      BOOTSTRAP_LOOP_FAKE_SCORER_RECORD: options.record,
      BOOTSTRAP_LOOP_SCORER_CMD: `bun ${FAKE_SCORER}`,
    },
    previousDir: options.previousDir,
    runDir,
  });

describe("isTimeRegression", () => {
  it("needs both more than 25% and more than 2 minutes", () => {
    expect(isTimeRegression(13, 10)).toBe(true);
    expect(isTimeRegression(5.5, 4)).toBe(false);
    expect(isTimeRegression(76, 60)).toBe(true);
    expect(isTimeRegression(12.5, 10)).toBe(false);
  });

  it("sums attempts because build.json totals already include every attempt", () => {
    const report = compareTimes({
      build: build({ai: 13}),
      previous: build({ai: 10}),
      scoreMinutes: 0,
    });
    expect(report.stages[0].regressed).toBe(true);
    expect(report.stages[0].previous).toBe(10);
  });

  it("flags a total regression and leaves stages without a previous unflagged", () => {
    const report = compareTimes({
      build: build({ai: 76}),
      previous: build({deploy: 60}),
      scoreMinutes: 1,
    });
    expect(report.totalRegressed).toBe(true);
    expect(report.totalMinutes).toBe(77);
    expect(report.stages[0].regressed).toBe(false);
  });
});

describe("scoreBuild", () => {
  it("passes when every probe passes, the scorer agrees and R3 scores 4", async () => {
    seed({ai: 1});
    const result = await score();
    expect(result.pass).toBe(true);
    expect(result.visualScore).toBe(4);
    expect(result.rows).toHaveLength(13);
    expect(readFileSync(join(runDir, "SCORE.md"), "utf8")).toContain("R3");
    expect(JSON.parse(readFileSync(join(runDir, "score.json"), "utf8")).pass).toBe(true);
  });

  it("fails when the scorer rejects a row the probe passed, keeping its reason", async () => {
    seed({ai: 1});
    const result = await score({mode: "failR3"});
    expect(result.pass).toBe(false);
    const r3 = result.rows.find((row) => row.row === "R3");
    expect(r3?.status).toBe("FAIL");
    expect(r3?.reason).toContain("unstyled");
  });

  it("fails an UNKNOWN probe row regardless of the scorer", async () => {
    seed({ai: 1});
    const result = await score({
      evidence: evidence({R13: {facts: ["DEPLOY_URL not set"], status: "UNKNOWN"}}),
    });
    expect(result.pass).toBe(false);
    expect(result.rows.find((row) => row.row === "R13")?.status).toBe("FAIL");
    expect(result.rows.find((row) => row.row === "R13")?.reason).toContain("DEPLOY_URL not set");
  });

  it("fails every row when the scorer output is not JSON", async () => {
    seed({ai: 1});
    const result = await score({mode: "garbage"});
    expect(result.pass).toBe(false);
    expect(result.rows.every((row) => row.status === "FAIL")).toBe(true);
    expect(result.rows[0].reason).toBe("scorer output unparsable");
  });

  it("flags time regressions against the previous run directory", async () => {
    seed({ai: 13});
    const previousDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-prev-"));
    try {
      writeFileSync(join(previousDir, "build.json"), JSON.stringify(build({ai: 10}, "58.0.5")));
      const result = await score({previousDir});
      expect(result.times.stages[0].regressed).toBe(true);
      expect(result.times.previousTotal).toBe(10);
    } finally {
      rmSync(previousDir, {force: true, recursive: true});
    }
  });

  it("copies CI, deploy and screenshot references into evidenceRefs", async () => {
    seed({ai: 1});
    const result = await score({
      evidence: evidence({
        R3: {artifacts: ["/x/login-desktop.png"]},
        R9: {facts: ["github run https://github.com/o/r/actions/runs/1 success"]},
        R13: {facts: ["https://app.example.com 200 at 2026-01-01T00:00:00Z"]},
      }),
    });
    expect(result.evidenceRefs.ci[0]).toContain("actions/runs/1");
    expect(result.evidenceRefs.deploy[0]).toContain("app.example.com");
    expect(result.evidenceRefs.screenshots).toContain("/x/login-desktop.png");
  });

  it("runs the scorer in the evidence directory with no builder log or secrets", async () => {
    seed({ai: 1});
    const record = join(runDir, "scorer-record.json");
    await score({record});
    const seen = JSON.parse(readFileSync(record, "utf8")) as {
      cwd: string;
      env: Record<string, string>;
      prompt: string;
    };
    expect(seen.cwd).toEndWith(join(runDir, "evidence"));
    expect(seen.prompt).not.toContain("BUILDER-TRANSCRIPT-MARKER");
    expect(seen.prompt).toContain("R13");
    for (const name of readdirSync(join(runDir, "evidence"))) {
      expect(readFileSync(join(runDir, "evidence", name), "utf8")).not.toContain(
        "BUILDER-TRANSCRIPT-MARKER"
      );
    }
    expect(Object.keys(seen.env).filter((name) => /TOKEN|SECRET|PASSWORD/.test(name))).toEqual([]);
  });
});
