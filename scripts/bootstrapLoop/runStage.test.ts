import {afterEach, beforeEach, describe, expect, it, setDefaultTimeout} from "bun:test";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {CHECKOUT_ROOT} from "./bootstrapPrompt";
import {runStage} from "./runStage";
import {pinTerrenoDependencies} from "./stages/scaffold";

setDefaultTimeout(90_000);

const FAKE_BUILDER = `bun ${join(import.meta.dir, "fixtures", "fakeBuilder.ts")}`;
const SAVED_ENV = {...process.env};

let runDir = "";

const setBuilder = (mode: string): void => {
  process.env.BOOTSTRAP_LOOP_BUILDER_CMD = FAKE_BUILDER;
  process.env.BOOTSTRAP_LOOP_FAKE_MODE = mode;
  process.env.BOOTSTRAP_LOOP_FAKE_PROMPT_FILE = join(runDir, "prompt.txt");
  process.env.BOOTSTRAP_LOOP_FAKE_ENV_FILE = join(runDir, "env.json");
  process.env.BOOTSTRAP_LOOP_SKIP_INSTALL = "1";
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-"));
});

afterEach(() => {
  process.env = {...SAVED_ENV};
  rmSync(runDir, {force: true, recursive: true});
});

describe("runStage scaffold", () => {
  it("passes and writes the stage JSON", async () => {
    setBuilder("fixture");
    const result = await runStage({runDir, stageId: "scaffold", version: "local"});
    expect(result.status).toBe("PASS");
    expect(result.attempt).toBe(1);
    expect(result.checks.find((check) => check.name === "backend-typecheck")?.status).toBe("PASS");
    const onDisk = readJson<{stage: string; status: string}>(
      join(runDir, "stages", "scaffold.json")
    );
    expect(onDisk.stage).toBe("scaffold");
    expect(onDisk.status).toBe("PASS");
  });

  it("gives the builder the naive prompt plus the local bootstrap prompt", async () => {
    setBuilder("fixture");
    await runStage({runDir, stageId: "scaffold", version: "local"});
    const prompt = readFileSync(join(runDir, "prompt.txt"), "utf8");
    expect(prompt).toContain("make me a todo app");
    expect(prompt).toContain(`--terreno-path ${CHECKOUT_ROOT}`);
    expect(prompt).not.toContain("bunx create-terreno-app");
  });

  it("leaves the app as a git repo with exactly one commit", async () => {
    setBuilder("fixture");
    await runStage({runDir, stageId: "scaffold", version: "local"});
    const count = Bun.spawnSync(["git", "rev-list", "--count", "HEAD"], {cwd: join(runDir, "app")});
    expect(count.stdout.toString().trim()).toBe("1");
  });

  it("increments attempt on a rerun and keeps the previous file", async () => {
    setBuilder("fixture");
    await runStage({runDir, stageId: "scaffold", version: "local"});
    const second = await runStage({runDir, stageId: "scaffold", version: "local"});
    expect(second.attempt).toBe(2);
    expect(existsSync(join(runDir, "stages", "scaffold.1.json"))).toBe(true);
  });

  it("pins Terreno dependencies to the exact published version", async () => {
    setBuilder("fixture");
    await runStage({runDir, stageId: "scaffold", version: "58.0.6"});
    for (const dir of ["backend", "frontend"]) {
      const pkg = readJson<{dependencies: Record<string, string>}>(
        join(runDir, "app", dir, "package.json")
      );
      expect(pkg.dependencies["@terreno/api"]).toBe("58.0.6");
      expect(pkg.dependencies["@terreno/ui"]).toBe("58.0.6");
      expect(pkg.dependencies.luxon).toBe("^3.7.2");
    }
  });

  it("fails with the builder exit code in the evidence", async () => {
    setBuilder("fail3");
    const result = await runStage({runDir, stageId: "scaffold", version: "local"});
    expect(result.status).toBe("FAIL");
    expect(result.checks.find((check) => check.name === "builder")?.ev).toContain(
      "builder exited 3"
    );
  });

  it("fails the type-check with the tsc output", async () => {
    setBuilder("tserror");
    const result = await runStage({runDir, stageId: "scaffold", version: "local"});
    expect(result.status).toBe("FAIL");
    const check = result.checks.find((item) => item.name === "backend-typecheck");
    expect(check?.status).toBe("FAIL");
    expect(check?.ev).toContain("TS2322");
  });

  it("keeps stage-gated secrets out of the builder env", async () => {
    setBuilder("fixture");
    process.env.CIRCLECI_TOKEN = "c";
    process.env.VERCEL_TOKEN = "v";
    process.env.GH_TOKEN = "g";
    process.env.BOOTSTRAP_LOOP_MONGO_URI = "mongodb://u:p@h/db";
    await runStage({runDir, stageId: "scaffold", version: "local"});
    const seen = readJson<Record<string, string>>(join(runDir, "env.json"));
    for (const name of ["CIRCLECI_TOKEN", "VERCEL_TOKEN", "GH_TOKEN", "BOOTSTRAP_LOOP_MONGO_URI"]) {
      expect(seen[name]).toBeUndefined();
    }
  });

  it("appends failures to the builder prompt", async () => {
    setBuilder("fixture");
    await runStage({
      failures: ["R6: no consent form"],
      runDir,
      stageId: "scaffold",
      version: "local",
    });
    const prompt = readFileSync(join(runDir, "prompt.txt"), "utf8");
    expect(prompt).toContain("## Fix these failures");
    expect(prompt).toContain("R6: no consent form");
  });

  it("rejects an unknown stage id naming the valid ones", async () => {
    await expect(runStage({runDir, stageId: "nope", version: "local"})).rejects.toThrow(
      "valid stages: scaffold"
    );
  });
});

describe("pinTerrenoDependencies", () => {
  it("returns nothing for a missing package.json", () => {
    expect(pinTerrenoDependencies(join(runDir, "missing.json"), "58.0.6")).toEqual([]);
  });
});

describe("cli", () => {
  it("exits 2 and names valid stages for an unknown stage", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        join(import.meta.dir, "cli.ts"),
        "stage",
        "nope",
        "--version",
        "local",
        "--run-dir",
        runDir,
      ],
      {env: process.env}
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("scaffold");
  });

  it("exits 1 when the builder fails", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        join(import.meta.dir, "cli.ts"),
        "stage",
        "scaffold",
        "--version",
        "local",
        "--run-dir",
        runDir,
      ],
      {
        env: {
          ...process.env,
          BOOTSTRAP_LOOP_BUILDER_CMD: FAKE_BUILDER,
          BOOTSTRAP_LOOP_FAKE_MODE: "fail3",
          // A fresh checkout has no install stamp; the real preflight would reinstall everything.
          BOOTSTRAP_LOOP_SKIP_PREFLIGHT: "1",
        },
      }
    );
    expect(result.exitCode).toBe(1);
  });
});
