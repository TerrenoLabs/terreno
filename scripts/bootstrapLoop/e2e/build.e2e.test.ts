import {afterAll, describe, expect, it, setDefaultTimeout} from "bun:test";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {stageIds} from "../stages";

setDefaultTimeout(540_000);

const ROOT = join(import.meta.dir, "..", "..", "..");
const runDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-e2-"));

afterAll(() => {
  rmSync(runDir, {force: true, recursive: true});
});

describe("bootstrap-loop build (process)", () => {
  it("runs all eleven stages in order and writes build.json", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        join(ROOT, "scripts/bootstrapLoop/cli.ts"),
        "build",
        "--version",
        "58.0.6",
        "--run-dir",
        runDir,
      ],
      {
        env: {
          ...process.env,
          BOOTSTRAP_LOOP_BUILDER_CMD: `bun ${join(ROOT, "scripts/bootstrapLoop/fixtures/fakeBuilder.ts")}`,
          BOOTSTRAP_LOOP_FAKE_MODE: "all",
        },
      }
    );
    expect(result.exitCode).toBe(0);
    for (const id of stageIds()) {
      expect(existsSync(join(runDir, "stages", `${id}.json`))).toBe(true);
    }
    const build = JSON.parse(readFileSync(join(runDir, "build.json"), "utf8")) as {
      stages: {id: string; totalMinutes: number}[];
      totalMinutes: number;
    };
    expect(build.stages.map((stage) => stage.id)).toEqual(stageIds());
    const sum = build.stages.reduce((total, stage) => total + stage.totalMinutes, 0);
    expect(Math.abs(build.totalMinutes - sum)).toBeLessThanOrEqual(0.1);
  });
});
