import {afterEach, beforeEach, describe, expect, it, setDefaultTimeout} from "bun:test";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {runStage} from "./runStage";
import {stageIds} from "./stages";
import {stagePromptPath} from "./stages/agentStage";

setDefaultTimeout(90_000);

const FAKE_BUILDER = `bun ${join(import.meta.dir, "fixtures", "fakeBuilder.ts")}`;
const SAVED_ENV = {...process.env};
const LATER_STAGES = [
  "auth",
  "admin",
  "theming",
  "features",
  "roles",
  "consent",
  "ai",
  "ci",
  "deploy",
  "checklist",
];

let runDir = "";

const setBuilder = (mode: string, files?: Record<string, string>): void => {
  process.env.BOOTSTRAP_LOOP_BUILDER_CMD = FAKE_BUILDER;
  process.env.BOOTSTRAP_LOOP_FAKE_MODE = mode;
  process.env.BOOTSTRAP_LOOP_FAKE_PROMPT_FILE = join(runDir, "prompt.txt");
  process.env.BOOTSTRAP_LOOP_FAKE_ENV_FILE = join(runDir, "env.json");
  if (files) {
    process.env.BOOTSTRAP_LOOP_FAKE_FILES = JSON.stringify(files);
  }
};

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-stages-"));
});

afterEach(() => {
  process.env = {...SAVED_ENV};
  rmSync(runDir, {force: true, recursive: true});
});

describe("stage registry", () => {
  it("lists the eleven stages in run order", () => {
    expect(stageIds()).toEqual(["scaffold", ...LATER_STAGES]);
  });

  it("has a no-human-input prompt file for every later stage", () => {
    for (const id of LATER_STAGES) {
      expect(existsSync(stagePromptPath(id))).toBe(true);
      expect(readFileSync(stagePromptPath(id), "utf8")).toContain("no human input");
    }
  });
});

describe("later stages through the builder", () => {
  it("passes checklist when the builder writes CHECKLIST.md", async () => {
    const items = [1, 2, 3, 4, 5].map((n) => `- [ ] item ${String(n)}`).join("\n");
    setBuilder("files", {"CHECKLIST.md": `${items}\n`});
    const result = await runStage({runDir, stageId: "checklist", version: "local"});
    expect(result.status).toBe("PASS");
    expect(result.checks.map((check) => check.name)).toEqual(["builder", "checklist-file"]);
    expect(existsSync(join(runDir, "stages", "checklist.json"))).toBe(true);
  });

  it("fails checklist when the builder exits 0 but writes nothing", async () => {
    setBuilder("noop");
    const result = await runStage({runDir, stageId: "checklist", version: "local"});
    expect(result.status).toBe("FAIL");
    const check = result.checks.find((item) => item.name === "checklist-file");
    expect(check?.ev).toBe("CHECKLIST.md missing");
  });

  it("stops at the builder check when the builder exits non-zero", async () => {
    setBuilder("fail3");
    const result = await runStage({runDir, stageId: "deploy", version: "local"});
    expect(result.status).toBe("FAIL");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].ev).toContain("builder exited 3");
  });

  it("sends the naive prompt, the stage prompt and the failures to the builder", async () => {
    setBuilder("noop");
    await runStage({
      failures: ["R6: no consent form"],
      runDir,
      stageId: "consent",
      version: "local",
    });
    const prompt = readFileSync(join(runDir, "prompt.txt"), "utf8");
    expect(prompt.startsWith("make me a todo app")).toBe(true);
    expect(prompt).toContain("# Stage: consent");
    expect(prompt).toContain("## Fix these failures");
    expect(prompt).toContain("R6: no consent form");
  });

  it("hands the CI token only to the ci stage", async () => {
    process.env.CIRCLECI_TOKEN = "circle-secret";
    process.env.BOOTSTRAP_LOOP_GH_TOKEN = "gh-secret";
    setBuilder("noop");
    await runStage({runDir, stageId: "ci", version: "local"});
    const ciEnv = JSON.parse(readFileSync(join(runDir, "env.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(ciEnv.CIRCLECI_TOKEN).toBe("circle-secret");
    await runStage({runDir, stageId: "auth", version: "local"});
    const authEnv = JSON.parse(readFileSync(join(runDir, "env.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(authEnv.CIRCLECI_TOKEN).toBeUndefined();
  });

  it("type-checks backend and frontend for a code stage", async () => {
    setBuilder("fixture");
    const result = await runStage({runDir, stageId: "roles", version: "local"});
    const names = result.checks.map((check) => check.name);
    expect(names).toContain("backend-typecheck");
    expect(names).toContain("frontend-typecheck");
    expect(result.checks.find((check) => check.name === "rbac-seed")?.status).toBe("FAIL");
  });
});
