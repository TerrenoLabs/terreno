import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import type {BuildResult, RunBuildOptions} from "./build";
import {runLoop} from "./loop";
import type {RowScore, ScoreResult} from "./score/score";

let runDir = "";

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-loop-"));
});

afterEach(() => {
  rmSync(runDir, {force: true, recursive: true});
});

const buildResult = (): BuildResult => ({
  endedAt: "",
  stages: [],
  startedAt: "",
  totalMinutes: 0,
  version: "local",
});

const scoreWith = (failing: Record<string, string>): ScoreResult => {
  const rows: RowScore[] = Array.from({length: 13}, (_, index) => {
    const row = `R${String(index + 1)}`;
    return failing[row]
      ? {reason: failing[row], row, status: "FAIL"}
      : {reason: "ok", row, status: "PASS"};
  });
  return {
    evidenceRefs: {ci: [], deploy: [], screenshots: []},
    pass: rows.every((row) => row.status === "PASS"),
    rows,
    times: {scoreMinutes: 0, stages: [], totalMinutes: 0, totalRegressed: false},
    version: "local",
    visualScore: 4,
  };
};

const harness = (scores: ScoreResult[], touch?: (options: RunBuildOptions) => void) => {
  const builds: RunBuildOptions[] = [];
  let scored = 0;
  return {
    builds,
    runBuild: async (options: RunBuildOptions): Promise<BuildResult> => {
      builds.push(options);
      touch?.(options);
      return buildResult();
    },
    scoreBuild: async (): Promise<ScoreResult> => scores[Math.min(scored++, scores.length - 1)],
  };
};

describe("runLoop", () => {
  it("reruns only consent when R6 fails once, then passes", async () => {
    const h = harness([scoreWith({R6: "no consent form"}), scoreWith({})]);
    const result = await runLoop({runDir, version: "local", ...h});
    expect(result.pass).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[1].rerunStages).toEqual(["consent"]);
    expect(h.builds[1].only).toEqual(["consent"]);
    expect(h.builds[1].failures).toEqual({consent: ["R6: no consent form"]});
    expect(result.iterations[0].failedRows).toEqual(["R6"]);
    expect(result.iterations[1].score).toEqual({passCount: 13, total: 13});
  });

  it("stops after max iterations when R9 never passes", async () => {
    const h = harness([scoreWith({R9: "CircleCI red"})]);
    const result = await runLoop({maxIterations: 3, runDir, version: "local", ...h});
    expect(result.pass).toBe(false);
    expect(result.iterations).toHaveLength(3);
    expect(result.iterations[2].failedRows).toEqual(["R9"]);
    const lines = readFileSync(join(runDir, "iterations.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(readFileSync(join(runDir, "ITERATIONS.md"), "utf8")).toContain("## Iteration 3");
  });

  it("reruns admin once when R1 and R12 both fail", async () => {
    const h = harness([scoreWith({R1: "no admin", R12: "no seed"}), scoreWith({})]);
    const result = await runLoop({runDir, version: "local", ...h});
    expect(result.iterations[1].rerunStages).toEqual(["admin"]);
    expect(h.builds[1].failures?.admin).toEqual(["R1: no admin", "R12: no seed"]);
  });

  it("lists files the builder touched in changedFiles", async () => {
    const appDir = join(runDir, "app");
    mkdirSync(appDir, {recursive: true});
    const sh = (...args: string[]): void => {
      execFileSync("git", args, {cwd: appDir, stdio: "ignore"});
    };
    sh("init", "-q");
    sh("config", "user.email", "t@example.com");
    sh("config", "user.name", "t");
    writeFileSync(join(appDir, "a.txt"), "a");
    sh("add", "-A");
    sh("commit", "-qm", "base");
    const h = harness([scoreWith({R6: "x"}), scoreWith({})], (options) => {
      if (options.only) {
        writeFileSync(join(appDir, "consent.txt"), "form");
      }
    });
    const result = await runLoop({runDir, version: "local", ...h});
    expect(result.iterations[1].changedFiles).toEqual(["consent.txt"]);
  });
});
