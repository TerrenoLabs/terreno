import {afterAll, beforeAll, describe, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {assert} from "chai";

import {generateAllFiles} from "../generate.js";

/**
 * Type-checks a freshly generated app against this monorepo's workspace packages (AC10:
 * scaffolded apps build without rtk/Redux). The generated `frontend/` and `backend/` borrow
 * the workspace `node_modules`, so the sibling `@terreno/*` packages must be compiled first
 * (`bun run compile` at the repo root). The suite skips, and says why, when they are not.
 */

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const WORKSPACE_NODE_MODULES = join(REPO_ROOT, "node_modules");
const TSC = join(WORKSPACE_NODE_MODULES, ".bin", "tsc");
const REQUIRED_DIST = [
  "admin-backend/dist/index.d.ts",
  "admin-frontend/dist/index.d.ts",
  "api/dist/index.d.ts",
  "api-health/dist/index.d.ts",
  "syncdb/dist/api/client.d.ts",
  "syncdb/dist/auth/auth.d.ts",
  "syncdb/dist/config/baseUrl.d.ts",
  "syncdb/dist/react/index.d.ts",
  "ui/dist/index.d.ts",
];
const COMPILE_TIMEOUT_MS = 240_000;

const missingDist = REQUIRED_DIST.filter((path) => !existsSync(join(REPO_ROOT, path)));
const canCompile = existsSync(TSC) && missingDist.length === 0;

if (!canCompile) {
  console.warn(
    `[generatedApp.compile] skipped: compile the workspace first (missing: ${
      existsSync(TSC) ? missingDist.join(", ") : TSC
    })`
  );
}

const runTsc = (projectDir: string): {exitCode: number; output: string} => {
  const result = Bun.spawnSync([TSC, "--noEmit", "-p", projectDir], {
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

describe.skipIf(!canCompile)("generated app compiles", () => {
  let appDir = "";

  beforeAll(() => {
    appDir = mkdtempSync(join(tmpdir(), "create-terreno-app-compile-"));
    for (const file of generateAllFiles({appDisplayName: "Compile App", appName: "compile-app"})) {
      const target = join(appDir, file.path);
      mkdirSync(dirname(target), {recursive: true});
      writeFileSync(target, file.content);
    }
    for (const part of ["frontend", "backend"]) {
      symlinkSync(WORKSPACE_NODE_MODULES, join(appDir, part, "node_modules"), "dir");
    }
  });

  afterAll(() => {
    if (appDir) {
      rmSync(appDir, {force: true, recursive: true});
    }
  });

  test(
    "frontend type-checks with syncdb request client, session, and generated apiSdk",
    () => {
      const {exitCode, output} = runTsc(join(appDir, "frontend"));
      assert.equal(exitCode, 0, output);
    },
    COMPILE_TIMEOUT_MS
  );

  test(
    "backend type-checks",
    () => {
      const {exitCode, output} = runTsc(join(appDir, "backend"));
      assert.equal(exitCode, 0, output);
    },
    COMPILE_TIMEOUT_MS
  );
});
