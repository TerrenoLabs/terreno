import {describe, test} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {assert} from "chai";

import {isEntryPoint, runCli} from "../cli.js";
import {
  deriveDisplayName,
  formatNextSteps,
  isTargetEmptyEnough,
  parseCliArgs,
  quoteShellArgument,
  writeScaffold,
} from "../writeScaffold.js";

const CLI_SOURCE = join(import.meta.dir, "../cli.ts");

const runCliProcess = async (
  args: string[],
  cwd: string
): Promise<{exitCode: number; stdout: string; stderr: string}> => {
  const proc = Bun.spawn(["bun", CLI_SOURCE, ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return {exitCode, stderr, stdout};
};

describe("parseCliArgs", () => {
  test("requires appName", () => {
    const parsed = parseCliArgs(["--display-name", "My App"]);
    assert.isUndefined(parsed.appName);
    assert.include(parsed.errors.join(" "), "appName");
  });

  test("requires display name unless --yes", () => {
    const parsed = parseCliArgs(["my-app"]);
    assert.equal(parsed.appName, "my-app");
    assert.isUndefined(parsed.displayName);
    assert.include(parsed.errors.join(" "), "--display-name");
  });

  test("derives display name with --yes", () => {
    const parsed = parseCliArgs(["my-app", "--yes"]);
    assert.equal(parsed.appName, "my-app");
    assert.equal(parsed.displayName, "My App");
    assert.isEmpty(parsed.errors);
  });

  test("accepts optional flags", () => {
    const parsed = parseCliArgs([
      "cool-app",
      "--display-name",
      "Cool App",
      "--description",
      "A cool app",
      "--mcp-server-url",
      "https://custom.example.com",
    ]);
    assert.equal(parsed.appName, "cool-app");
    assert.equal(parsed.displayName, "Cool App");
    assert.equal(parsed.description, "A cool app");
    assert.equal(parsed.mcpServerUrl, "https://custom.example.com");
    assert.isEmpty(parsed.errors);
  });
});

describe("writeScaffold", () => {
  test("writes backend and frontend package.json in an empty temp dir", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-"));
    try {
      const result = writeScaffold({
        appDisplayName: "My App",
        appName: "my-app",
        parentDir,
      });

      assert.isTrue(result.success);
      assert.equal(result.exitCode, 0);
      assert.isTrue(existsSync(join(result.targetPath, "backend/package.json")));
      assert.isTrue(existsSync(join(result.targetPath, "frontend/package.json")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("refuses a non-empty target without writing app files", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-dirty-"));
    const targetPath = join(parentDir, "my-app");
    try {
      mkdirSync(targetPath, {recursive: true});
      writeFileSync(join(targetPath, "blocker.txt"), "keep me", "utf8");

      const result = writeScaffold({
        appDisplayName: "My App",
        appName: "my-app",
        parentDir,
      });

      assert.isFalse(result.success);
      assert.notEqual(result.exitCode, 0);
      assert.isFalse(existsSync(join(targetPath, "backend/package.json")));
      assert.isTrue(existsSync(join(targetPath, "blocker.txt")));
      assert.equal(readFileSync(join(targetPath, "blocker.txt"), "utf8"), "keep me");
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("allows only .git and .gitignore in an existing target directory", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-git-"));
    const targetPath = join(parentDir, "my-app");
    try {
      mkdirSync(targetPath, {recursive: true});
      mkdirSync(join(targetPath, ".git"), {recursive: true});
      writeFileSync(join(targetPath, ".gitignore"), "node_modules/\n", "utf8");

      const result = writeScaffold({
        appDisplayName: "My App",
        appName: "my-app",
        parentDir,
      });

      assert.isTrue(result.success);
      assert.isTrue(existsSync(join(targetPath, "backend/package.json")));
      assert.isTrue(existsSync(join(targetPath, ".git")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("formatNextSteps includes install, seed, sdk, and web commands", () => {
    const steps = formatNextSteps("/tmp/my-app");
    const joined = steps.join("\n");
    assert.include(joined, "bun install");
    assert.include(joined, "bun run seed");
    assert.include(joined, "bun run sdk");
    assert.include(joined, "bun run web");
  });

  test("formatNextSteps seeds before starting the long-running backend", () => {
    const steps = formatNextSteps("/tmp/my-app");
    const seedIndex = steps.findIndex((step) => step.includes("bun run seed"));
    const devIndex = steps.findIndex((step) => step.includes("bun run dev"));
    const sdkIndex = steps.findIndex((step) => step.includes("bun run sdk"));
    assert.isAtLeast(seedIndex, 0);
    assert.isAtLeast(devIndex, 0);
    assert.isBelow(seedIndex, devIndex);
    assert.isBelow(devIndex, sdkIndex);
    assert.include(steps.join("\n"), "In another terminal");
  });

  test("rejects an invalid appName without writing files", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-escape-"));
    try {
      const result = writeScaffold({
        appDisplayName: "Escape",
        appName: "../escape",
        parentDir,
      });
      assert.isFalse(result.success);
      assert.notEqual(result.exitCode, 0);
      assert.include(result.error ?? "", "kebab-case");
      assert.isEmpty(readdirSync(parentDir));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });
});

describe("isTargetEmptyEnough", () => {
  test("accepts missing directory", () => {
    assert.isTrue(isTargetEmptyEnough(join(tmpdir(), "does-not-exist-create-terreno-app")));
  });

  test("rejects unexpected files", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-terreno-app-check-"));
    try {
      writeFileSync(join(dir, "notes.txt"), "nope", "utf8");
      assert.isFalse(isTargetEmptyEnough(dir));
    } finally {
      rmSync(dir, {force: true, recursive: true});
    }
  });

  test("rejects a file path in place of a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-terreno-app-file-"));
    const filePath = join(dir, "not-a-dir");
    try {
      writeFileSync(filePath, "nope", "utf8");
      assert.isFalse(isTargetEmptyEnough(filePath));
    } finally {
      rmSync(dir, {force: true, recursive: true});
    }
  });
});

describe("deriveDisplayName", () => {
  test("title-cases kebab-case app names", () => {
    assert.equal(deriveDisplayName("my-app"), "My App");
    assert.equal(deriveDisplayName("billing-portal"), "Billing Portal");
  });
});

describe("quoteShellArgument", () => {
  test("single-quotes spaces and shell substitutions", () => {
    assert.equal(quoteShellArgument("/tmp/my app/$(touch nope)"), "'/tmp/my app/$(touch nope)'");
    assert.equal(quoteShellArgument("safe-app"), "safe-app");
  });
});

describe("runCli", () => {
  test("writes a scaffold and prints next steps", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-runcli-"));
    try {
      const result = runCli({
        argv: ["runcli-app", "--yes"],
        cwd: parentDir,
      });
      assert.isTrue(result.success);
      assert.equal(result.exitCode, 0);
      assert.isTrue(existsSync(join(parentDir, "runcli-app/backend/package.json")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("returns errors for missing display name", () => {
    const result = runCli({
      argv: ["my-app"],
    });
    assert.isFalse(result.success);
    assert.equal(result.exitCode, 1);
    assert.include(result.error ?? "", "--display-name");
  });

  test("returns errors for a dirty target", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-runcli-dirty-"));
    const targetPath = join(parentDir, "my-app");
    try {
      mkdirSync(targetPath, {recursive: true});
      writeFileSync(join(targetPath, "blocker.txt"), "stay", "utf8");
      const result = runCli({
        argv: ["my-app", "--display-name", "My App"],
        cwd: parentDir,
      });
      assert.isFalse(result.success);
      assert.notEqual(result.exitCode, 0);
      assert.include(result.error ?? "", "not empty");
      assert.isFalse(existsSync(join(targetPath, "backend/package.json")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });
});

describe("create-terreno-app bin", () => {
  test("writes scaffold files and prints next steps", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-cli-"));
    try {
      const {exitCode, stdout, stderr} = await runCliProcess(
        ["my-app", "--display-name", "My App"],
        parentDir
      );

      assert.equal(exitCode, 0, stderr);
      assert.include(stdout, "bun install");
      assert.include(stdout, "bun run seed");
      assert.include(stdout, "bun run sdk");
      assert.include(stdout, "bun run web");
      assert.isTrue(existsSync(join(parentDir, "my-app/backend/package.json")));
      assert.isTrue(existsSync(join(parentDir, "my-app/frontend/package.json")));
      assert.isFalse(existsSync(join(parentDir, "my-app/backend/node_modules")));
      assert.isFalse(existsSync(join(parentDir, "my-app/frontend/node_modules")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("--yes succeeds without --display-name", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-yes-"));
    try {
      const {exitCode, stderr} = await runCliProcess(["billing-app", "--yes"], parentDir);
      assert.equal(exitCode, 0, stderr);
      assert.isTrue(existsSync(join(parentDir, "billing-app/backend/package.json")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("exits non-zero when display name is missing", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-missing-name-"));
    try {
      const {exitCode} = await runCliProcess(["my-app"], parentDir);
      assert.notEqual(exitCode, 0);
      assert.isFalse(existsSync(join(parentDir, "my-app")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("exits non-zero when appName is missing", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-missing-app-"));
    try {
      const {exitCode} = await runCliProcess(["--display-name", "My App"], parentDir);
      assert.notEqual(exitCode, 0);
      assert.isEmpty(readdirSync(parentDir));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("exits non-zero on dirty target without writing app files", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-cli-dirty-"));
    const targetPath = join(parentDir, "my-app");
    try {
      mkdirSync(targetPath, {recursive: true});
      writeFileSync(join(targetPath, "blocker.txt"), "stay", "utf8");
      const {exitCode} = await runCliProcess(["my-app", "--display-name", "My App"], parentDir);
      assert.notEqual(exitCode, 0);
      assert.isFalse(existsSync(join(targetPath, "backend/package.json")));
      assert.equal(readFileSync(join(targetPath, "blocker.txt"), "utf8"), "stay");
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("rejects unknown options without writing files", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-unknown-"));
    try {
      const {exitCode, stderr} = await runCliProcess(
        ["my-app", "--display-name", "My App", "--bogus"],
        parentDir
      );
      assert.notEqual(exitCode, 0);
      assert.include(stderr, "Unknown option: --bogus");
      assert.isEmpty(readdirSync(parentDir));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("rejects invalid app names without writing files", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-invalid-"));
    try {
      const {exitCode, stderr} = await runCliProcess(
        ["../escape", "--display-name", "Escape"],
        parentDir
      );
      assert.notEqual(exitCode, 0);
      assert.include(stderr, "appName must be kebab-case");
      assert.isEmpty(readdirSync(parentDir));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });

  test("writes into a git-initialized target", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "create-terreno-app-existing-git-"));
    const targetPath = join(parentDir, "my-app");
    try {
      mkdirSync(join(targetPath, ".git"), {recursive: true});
      writeFileSync(join(targetPath, ".gitignore"), "local-only\n", "utf8");
      const {exitCode, stderr} = await runCliProcess(
        ["my-app", "--display-name", "My App"],
        parentDir
      );
      assert.equal(exitCode, 0, stderr);
      assert.isTrue(existsSync(join(targetPath, ".git")));
      assert.isTrue(existsSync(join(targetPath, "backend/package.json")));
    } finally {
      rmSync(parentDir, {force: true, recursive: true});
    }
  });
});

describe("isEntryPoint", () => {
  test("matches the module run directly or through a bin symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "cta-entry-"));
    try {
      const cliPath = join(dir, "cli.js");
      writeFileSync(cliPath, "");
      const binPath = join(dir, "create-terreno-app");
      symlinkSync(cliPath, binPath);
      const moduleUrl = pathToFileURL(cliPath).href;
      assert.isTrue(isEntryPoint(moduleUrl, cliPath));
      assert.isTrue(isEntryPoint(moduleUrl, binPath));
      assert.isFalse(isEntryPoint(moduleUrl, join(dir, "other.js")));
      assert.isFalse(isEntryPoint(moduleUrl, undefined));
    } finally {
      rmSync(dir, {force: true, recursive: true});
    }
  });

  test("matches when the module URL itself goes through a symlinked directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "cta-entry-"));
    try {
      const realDir = join(dir, "real");
      mkdirSync(realDir);
      writeFileSync(join(realDir, "cli.js"), "");
      const linkedDir = join(dir, "linked");
      symlinkSync(realDir, linkedDir);
      const moduleUrl = pathToFileURL(join(linkedDir, "cli.js")).href;
      assert.isTrue(isEntryPoint(moduleUrl, join(realDir, "cli.js")));
      assert.isTrue(isEntryPoint(moduleUrl, join(linkedDir, "cli.js")));
    } finally {
      rmSync(dir, {force: true, recursive: true});
    }
  });
});
