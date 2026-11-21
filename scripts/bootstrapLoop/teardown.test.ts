import {afterEach, describe, expect, it} from "bun:test";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {run as runTeardown} from "./commands/teardown";
import {teardownRun} from "./teardown";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, {force: true, recursive: true});
  }
});

const makeRun = (deploy: Record<string, unknown>): string => {
  const runDir = mkdtempSync(join(tmpdir(), "teardown-"));
  dirs.push(runDir);
  writeFileSync(join(runDir, "deploy.json"), JSON.stringify(deploy));
  return runDir;
};

const fakeCommand = (): {command: string; log: string} => {
  const dir = mkdtempSync(join(tmpdir(), "teardown-cmd-"));
  dirs.push(dir);
  const log = join(dir, "calls.log");
  const script = join(dir, "fake.sh");
  writeFileSync(
    script,
    `#!/bin/sh\necho "$1 $BOOTSTRAP_LOOP_DEPLOY_ID $BOOTSTRAP_LOOP_DATABASE $BOOTSTRAP_LOOP_BRANCH" >> ${log}\n`,
    {mode: 0o755}
  );
  return {command: script, log};
};

const deploy = {branch: "loop-58", database: "todo_58", deployId: "dpl_1", url: "https://t.test"};

describe("teardownRun", () => {
  it("passes deploy id, database and branch to the teardown command for each resource", async () => {
    const {command, log} = fakeCommand();
    const runDir = makeRun(deploy);
    const {removed} = await teardownRun({command, env: {}, runDir});
    expect(removed).toEqual(["deploy:dpl_1", "database:todo_58", "branch:loop-58"]);
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines).toEqual([
      "deploy dpl_1 todo_58 loop-58",
      "database dpl_1 todo_58 loop-58",
      "branch dpl_1 todo_58 loop-58",
    ]);
  });

  it("finds deploy.json inside the app dir", async () => {
    const {command} = fakeCommand();
    const runDir = mkdtempSync(join(tmpdir(), "teardown-"));
    dirs.push(runDir);
    require("node:fs").mkdirSync(join(runDir, "app"));
    writeFileSync(join(runDir, "app", "deploy.json"), JSON.stringify(deploy));
    const {removed} = await teardownRun({command, env: {}, runDir});
    expect(removed).toHaveLength(3);
  });

  it("skips resources the deploy stage did not record", async () => {
    const {command} = fakeCommand();
    const runDir = makeRun({deployId: "dpl_1", url: "https://t.test"});
    const {removed} = await teardownRun({command, env: {}, runDir});
    expect(removed).toEqual(["deploy:dpl_1"]);
  });

  it("throws when the command fails", async () => {
    const runDir = makeRun(deploy);
    await expect(teardownRun({command: "false", env: {}, runDir})).rejects.toThrow("deploy");
  });
});

describe("teardown command", () => {
  it("exits 2 on a run marked keep: true without calling the command", async () => {
    const {command, log} = fakeCommand();
    const runDir = makeRun({...deploy, keep: true});
    process.env.BOOTSTRAP_LOOP_TEARDOWN_CMD = command;
    const original = console.error;
    console.error = () => {};
    const code = await runTeardown(["--run-dir", runDir]);
    console.error = original;
    delete process.env.BOOTSTRAP_LOOP_TEARDOWN_CMD;
    expect(code).toBe(2);
    expect(() => readFileSync(log, "utf8")).toThrow();
  });

  it("exits 0 and tears down when not kept", async () => {
    const {command, log} = fakeCommand();
    const runDir = makeRun(deploy);
    process.env.BOOTSTRAP_LOOP_TEARDOWN_CMD = command;
    const code = await runTeardown(["--run-dir", runDir]);
    delete process.env.BOOTSTRAP_LOOP_TEARDOWN_CMD;
    expect(code).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("deploy dpl_1 todo_58 loop-58");
  });
});
