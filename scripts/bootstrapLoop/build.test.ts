import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {runBuild} from "./build";
import {nextAttempt, writeStageResult} from "./stageResult";
import {stageIds} from "./stages";
import type {RunStageOptions, StageResult} from "./types";

let runDir = "";

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-build-"));
});

afterEach(() => {
  rmSync(runDir, {force: true, recursive: true});
});

const fakeResult = (
  options: RunStageOptions,
  status: "PASS" | "FAIL",
  minutes: number
): StageResult => ({
  attempt: nextAttempt(options.runDir, options.stageId),
  checks: [],
  endedAt: "2026-01-01T00:00:00.000Z",
  log: "",
  minutes,
  stage: options.stageId,
  startedAt: "2026-01-01T00:00:00.000Z",
  status,
  version: options.version,
});

/** Records the order of calls and writes a real stage file per call. */
const recorder = (failOn?: string, minutes = 1) => {
  const calls: string[] = [];
  const runStage = async (options: RunStageOptions): Promise<StageResult> => {
    calls.push(options.stageId);
    const result = fakeResult(options, options.stageId === failOn ? "FAIL" : "PASS", minutes);
    writeStageResult(options.runDir, result);
    return result;
  };
  return {calls, runStage};
};

describe("runBuild", () => {
  it("runs all eleven stages in registry order and sums minutes", async () => {
    const {calls, runStage} = recorder(undefined, 1.5);
    const build = await runBuild({runDir, runStage, version: "local"});
    expect(calls).toEqual(stageIds());
    expect(build.stages.map((stage) => stage.id)).toEqual(stageIds());
    expect(build.totalMinutes).toBeCloseTo(16.5, 1);
  });

  it("sums every attempt already in the run dir", async () => {
    for (const minutes of [4, 3]) {
      writeStageResult(
        runDir,
        fakeResult({runDir, stageId: "roles", version: "local"}, "FAIL", minutes)
      );
    }
    const {runStage} = recorder();
    const build = await runBuild({only: ["ai"], runDir, runStage, version: "local"});
    const roles = build.stages.find((stage) => stage.id === "roles");
    expect(roles?.attempts).toBe(2);
    expect(roles?.firstPassMinutes).toBe(4);
    expect(roles?.totalMinutes).toBe(7);
  });

  it("stops at the first failure", async () => {
    const {calls, runStage} = recorder("roles");
    const build = await runBuild({runDir, runStage, version: "local"});
    expect(calls.at(-1)).toBe("roles");
    expect(build.stages.map((stage) => stage.id)).not.toContain("consent");
  });

  it("keeps going past a failure with keepGoing", async () => {
    const {calls, runStage} = recorder("roles");
    const build = await runBuild({keepGoing: true, runDir, runStage, version: "local"});
    expect(calls).toEqual(stageIds());
    expect(build.stages.find((stage) => stage.id === "roles")?.status).toBe("FAIL");
  });

  it("reruns only consent onward with from and leaves earlier files alone", async () => {
    const first = recorder();
    await runBuild({runDir, runStage: first.runStage, version: "local"});
    const second = recorder();
    await runBuild({from: "consent", runDir, runStage: second.runStage, version: "local"});
    expect(second.calls).toEqual(["consent", "ai", "ci", "deploy", "checklist"]);
  });

  it("runs exactly the stages named by only, in registry order", async () => {
    const {calls, runStage} = recorder();
    await runBuild({only: ["deploy", "ai"], runDir, runStage, version: "local"});
    expect(calls).toEqual(["ai", "deploy"]);
  });

  it("rejects unknown stage ids", async () => {
    const {runStage} = recorder();
    await expect(runBuild({from: "nope", runDir, runStage, version: "local"})).rejects.toThrow(
      "unknown stage"
    );
  });
});
