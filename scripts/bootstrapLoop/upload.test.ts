import {afterEach, describe, expect, it} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {run as runUpload} from "./commands/upload";
import {uploadRun} from "./upload";

const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "upload-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, {force: true, recursive: true});
  }
});

const put = (root: string, path: string, content: string): void => {
  const full = join(root, path);
  mkdirSync(join(full, ".."), {recursive: true});
  writeFileSync(full, content);
};

const makeRun = (): string => {
  const runDir = temp();
  put(runDir, "app/node_modules/x/index.js", "x");
  put(runDir, "app/backend/.env", "BETTER_AUTH_SECRET=s3cr3t");
  put(runDir, "app/frontend/.env.local", "EXPO_PUBLIC_API_URL=http://x");
  put(runDir, "app/.vercel/project.json", "{}");
  put(runDir, "app/.git/HEAD", "ref");
  put(runDir, "app/backend/src/index.ts", "export {};");
  put(runDir, "evidence/login-desktop.png", "png");
  put(runDir, "evidence/evidence.json", "{}");
  put(runDir, "score.json", "{}");
  put(runDir, "SCORE.md", "# score");
  put(runDir, "ITERATIONS.md", "# iterations");
  put(runDir, "build.json", "{}");
  put(runDir, "stages/auth.json", JSON.stringify({log: "token is vtok-123 done"}));
  return runDir;
};

const tarList = async (path: string): Promise<string[]> => {
  const proc = Bun.spawn(["tar", "-tzf", path], {stdout: "pipe"});
  const out = await new Response(proc.stdout).text();
  return out.split("\n").filter(Boolean);
};

describe("uploadRun", () => {
  it("tars the app without secrets, deps, vercel state or git", async () => {
    const runDir = makeRun();
    const dest = join(temp(), "missing", "dest");
    const {files} = await uploadRun({dest, env: {}, runDir});
    const entries = await tarList(join(dest, "app.tar.gz"));
    expect(entries.some((entry) => entry.includes("backend/src/index.ts"))).toBe(true);
    for (const banned of ["node_modules", ".env", ".vercel", ".git/"]) {
      expect(entries.some((entry) => entry.includes(banned))).toBe(false);
    }
    expect(files).toContain("app.tar.gz");
    expect(files).toContain("screenshots/login-desktop.png");
    for (const report of [
      "evidence.json",
      "score.json",
      "SCORE.md",
      "ITERATIONS.md",
      "build.json",
    ]) {
      expect(existsSync(join(dest, report))).toBe(true);
    }
    expect(existsSync(join(dest, "REGRESSIONS.md"))).toBe(false);
  });

  it("copies REGRESSIONS.md when present", async () => {
    const runDir = makeRun();
    put(runDir, "REGRESSIONS.md", "# regressions");
    const dest = temp();
    const {files} = await uploadRun({dest, env: {}, runDir});
    expect(files).toContain("REGRESSIONS.md");
  });

  it("redacts secret values from uploaded text files", async () => {
    const runDir = makeRun();
    const dest = temp();
    await uploadRun({dest, env: {VERCEL_TOKEN: "vtok-123"}, runDir});
    const stage = readFileSync(join(dest, "stages", "auth.json"), "utf8");
    expect(stage).toContain("[redacted]");
    expect(stage).not.toContain("vtok-123");
  });

  it("redacts values from the app's own .env files", async () => {
    const runDir = makeRun();
    put(runDir, "SCORE.md", "leaked s3cr3t here");
    const dest = temp();
    await uploadRun({dest, env: {}, runDir});
    expect(readFileSync(join(dest, "SCORE.md"), "utf8")).toBe("leaked [redacted] here");
  });

  it("rejects a run without score.json naming it", async () => {
    const runDir = makeRun();
    rmSync(join(runDir, "score.json"));
    await expect(uploadRun({dest: temp(), env: {}, runDir})).rejects.toThrow("score.json");
  });
});

describe("upload command", () => {
  it("exits 1 naming the missing file", async () => {
    const runDir = makeRun();
    rmSync(join(runDir, "score.json"));
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    const code = await runUpload(["--run-dir", runDir, "--dest", temp()]);
    console.error = original;
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("score.json");
  });

  it("exits 2 without --run-dir", async () => {
    const original = console.error;
    console.error = () => {};
    expect(await runUpload([])).toBe(2);
    console.error = original;
  });

  it("defaults dest to BOOTSTRAP_LOOP_ARTIFACTS/<runId>", async () => {
    const runDir = makeRun();
    const artifacts = temp();
    process.env.BOOTSTRAP_LOOP_ARTIFACTS = artifacts;
    const code = await runUpload(["--run-dir", runDir]);
    delete process.env.BOOTSTRAP_LOOP_ARTIFACTS;
    const runId = runDir.split("/").pop() as string;
    expect(code).toBe(0);
    expect(existsSync(join(artifacts, runId, "app.tar.gz"))).toBe(true);
  });
});
