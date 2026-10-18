import {describe, it} from "bun:test";
import {join, resolve} from "node:path";
import {assert} from "chai";

import {parseLcov} from "./check-coverage";
import {
  bunTestFileArgs,
  colocatedTestCandidates,
  coverageRunArgs,
  evaluateNewFileCoverage,
  expandCoverageRunArgs,
  findColocatedTests,
  groupFilesByWorkspace,
  isCoveragePathIgnored,
  isCoverageSourceFile,
  PACKAGE_CI_LCOV_SKIP,
  packageNeedsCompiledDistDeps,
  parseNewFileCoverageArgs,
  readCoveragePathIgnorePatterns,
  workspaceDepsCompileArgs,
} from "./check-new-file-coverage";

describe("parseNewFileCoverageArgs", () => {
  it("requires callers to provide a base and defaults to 90 percent", () => {
    assert.deepEqual(parseNewFileCoverageArgs(["--base=abc123"]), {
      base: "abc123",
      lcovPath: null,
      packageName: null,
      skipPackages: [],
      threshold: 90,
    });
  });

  it("accepts a custom threshold", () => {
    assert.deepEqual(parseNewFileCoverageArgs(["--base=abc123", "--threshold=95"]), {
      base: "abc123",
      lcovPath: null,
      packageName: null,
      skipPackages: [],
      threshold: 95,
    });
  });

  it("accepts lcov reuse, package filter, and skip list", () => {
    assert.deepEqual(
      parseNewFileCoverageArgs([
        "--base=abc123",
        "--package=api",
        "--lcov=api/coverage/lcov.info",
        "--skip-packages=api, ui",
      ]),
      {
        base: "abc123",
        lcovPath: "api/coverage/lcov.info",
        packageName: "api",
        skipPackages: ["api", "ui"],
        threshold: 90,
      }
    );
  });
});

describe("isCoverageSourceFile", () => {
  it("includes implementation TypeScript files", () => {
    assert.isTrue(isCoverageSourceFile("api/src/newRoute.ts"));
    assert.isTrue(isCoverageSourceFile("ui/src/NewComponent.tsx"));
  });

  it("excludes tests, stories, e2e helpers, generated SDKs, and non-source files", () => {
    assert.isFalse(isCoverageSourceFile("api/src/newRoute.test.ts"));
    assert.isFalse(isCoverageSourceFile("ui/src/NewComponent.stories.tsx"));
    assert.isFalse(isCoverageSourceFile("example-frontend/e2e/helpers/auditEvents.ts"));
    assert.isFalse(isCoverageSourceFile("example-frontend/store/openApiSdk.ts"));
    assert.isFalse(isCoverageSourceFile("api/src/readme.md"));
    assert.isFalse(isCoverageSourceFile("api/src/types/authToken.ts"));
    assert.isFalse(isCoverageSourceFile("announcements/src/types.ts"));
    assert.isFalse(isCoverageSourceFile("admin-frontend/src/testing/useAdminApiDouble.ts"));
    assert.isFalse(isCoverageSourceFile("jobs/src/types.ts"));
    assert.isFalse(isCoverageSourceFile("example-backend/src/jobsWorker.ts"));
    assert.isFalse(isCoverageSourceFile("demo/story-config/LoginScreen.config.tsx"));
    assert.isFalse(isCoverageSourceFile("api/src/migrations/fixtures/bad-name/not-a-migration.ts"));
  });

  it("excludes Expo Router route-structural entry files but keeps other app modules", () => {
    assert.isFalse(isCoverageSourceFile("example-frontend/app/admin/comms/index.tsx"));
    assert.isFalse(isCoverageSourceFile("example-frontend/app/admin/comms/[id].tsx"));
    assert.isFalse(isCoverageSourceFile("admin-spa/app/comms/index.tsx"));
    assert.isFalse(isCoverageSourceFile("admin-spa/app/[model]/_layout.tsx"));
    assert.isFalse(isCoverageSourceFile("admin-spa/app/+not-found.tsx"));
    assert.isTrue(isCoverageSourceFile("example-frontend/app/admin/SyncLabScreen.tsx"));
    assert.isFalse(isCoverageSourceFile("example-frontend/app/forgotPassword.tsx"));
    assert.isFalse(isCoverageSourceFile("example-frontend/app/resetPassword.tsx"));
    assert.isFalse(isCoverageSourceFile("example-frontend/app/verifyEmail.tsx"));
    assert.isFalse(isCoverageSourceFile("example-frontend/app/admin/announcements/create.tsx"));
    assert.isTrue(isCoverageSourceFile("example-frontend/store/index.ts"));
  });
});

describe("groupFilesByWorkspace", () => {
  it("groups only files that belong to declared workspaces", () => {
    assert.deepEqual(
      groupFilesByWorkspace({
        files: ["scripts/tool.ts", "ui/src/New.tsx", "api/src/new.ts"],
        workspaces: new Set(["api", "ui"]),
      }),
      [
        {files: ["api/src/new.ts"], packageName: "api"},
        {files: ["ui/src/New.tsx"], packageName: "ui"},
      ]
    );
  });
});

describe("evaluateNewFileCoverage", () => {
  const repoRoot = "/repo";
  const packageRoot = "/repo/api";

  it("passes files whose function and line coverage meet 90 percent", () => {
    const coverage = parseLcov(
      [
        "SF:src/new.ts",
        "FN:1,covered",
        "FNDA:1,covered",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "DA:2,1",
        "LF:2",
        "LH:2",
        "end_of_record",
      ].join("\n")
    );
    assert.deepEqual(
      evaluateNewFileCoverage({
        coverage,
        files: ["api/src/new.ts"],
        packageRoot,
        repoRoot,
        threshold: 90,
      }),
      []
    );
  });

  it("fails files below the threshold", () => {
    const coverage = parseLcov(
      [
        "SF:/repo/api/src/new.ts",
        "FN:1,covered",
        "FN:5,missed",
        "FNDA:1,covered",
        "FNDA:0,missed",
        "FNF:2",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "LF:2",
        "LH:1",
        "end_of_record",
      ].join("\n")
    );
    const failures = evaluateNewFileCoverage({
      coverage,
      files: ["api/src/new.ts"],
      packageRoot,
      repoRoot,
      threshold: 90,
    });
    assert.lengthOf(failures, 1);
    assert.deepEqual(failures[0].summary, {functions: 50, lines: 50});
  });

  it("treats files missing from LCOV as uncovered", () => {
    assert.deepEqual(
      evaluateNewFileCoverage({
        coverage: new Map(),
        files: ["api/src/new.ts"],
        packageRoot,
        repoRoot,
        threshold: 90,
      }),
      [{path: "api/src/new.ts", summary: null}]
    );
  });

  it("skips files listed in bunfig coveragePathIgnorePatterns", () => {
    const mcpRoot = resolve(import.meta.dir, "../mcp-server");
    const patterns = readCoveragePathIgnorePatterns(mcpRoot);
    assert.include(patterns, "**/local/metro/metroDevSession.ts");
    assert.isTrue(isCoveragePathIgnored("src/local/metro/metroDevSession.ts", patterns));
    assert.deepEqual(
      evaluateNewFileCoverage({
        coverage: new Map(),
        files: ["mcp-server/src/local/metro/metroDevSession.ts"],
        packageRoot: mcpRoot,
        repoRoot: resolve(import.meta.dir, ".."),
        threshold: 90,
      }),
      []
    );
  });
});

describe("coverageRunArgs", () => {
  it("reuses explicit bun test file globs so Playwright specs stay out", () => {
    assert.deepEqual(bunTestFileArgs("bun test ./**/*.test.ts ./**/*.test.tsx"), [
      "./**/*.test.ts",
      "./**/*.test.tsx",
    ]);
    assert.deepEqual(
      coverageRunArgs({
        hasSrcDir: false,
        packageName: "example-frontend",
        testScript: "bun test ./**/*.test.ts ./**/*.test.tsx",
      }),
      ["./**/*.test.ts", "./**/*.test.tsx"]
    );
  });

  it("ignores flags and chained isolated-test shells", () => {
    assert.deepEqual(bunTestFileArgs("bun test --max-concurrency=1 src/"), ["src/"]);
    assert.deepEqual(bunTestFileArgs("bun test && bun test ./src/isolated/*.isolated.ts"), []);
    assert.deepEqual(bunTestFileArgs("bun test --preload ./src/tests/bunSetup.ts"), []);
    assert.deepEqual(
      coverageRunArgs({
        hasSrcDir: true,
        packageName: "ai",
        testScript:
          'bun test --preload ./src/tests/bunSetup.ts && for f in ./src/isolated/*.isolated.ts; do bun test --preload ./src/tests/bunSetup.ts "$f" || exit 1; done',
      }),
      ["src"]
    );
  });

  it("falls back to src or unit-test globs when the script has no paths", () => {
    assert.deepEqual(
      coverageRunArgs({hasSrcDir: true, packageName: "api", testScript: "bun test"}),
      ["src"]
    );
    assert.deepEqual(coverageRunArgs({hasSrcDir: false, packageName: "example-frontend"}), [
      "./**/*.test.ts",
      "./**/*.test.tsx",
    ]);
    assert.deepEqual(
      coverageRunArgs({hasSrcDir: true, packageName: "mcp-server", testScript: "bun test"}),
      ["--max-concurrency=1", "src"]
    );
  });

  it("prefers colocated tests over the full package suite", () => {
    assert.deepEqual(
      coverageRunArgs({
        colocatedTests: ["src/new.ts"].flatMap(() => ["src/new.test.ts"]),
        hasSrcDir: true,
        packageName: "api",
        testScript: "bun test",
      }),
      ["src/new.test.ts"]
    );
  });
});

describe("findColocatedTests", () => {
  const repoRoot = resolve(import.meta.dir, "..");

  it("maps a source file to sibling test files", () => {
    assert.deepEqual(colocatedTestCandidates("api/src/errors.ts"), [
      "api/src/errors.test.ts",
      "api/src/errors.test.tsx",
      "api/src/errors.spec.ts",
      "api/src/errors.spec.tsx",
    ]);
    assert.deepEqual(
      findColocatedTests({
        files: ["api/src/errors.ts"],
        packageRoot: join(repoRoot, "api"),
        repoRoot,
      }),
      ["src/errors.test.ts"]
    );
  });

  it("returns null when any new file lacks a colocated test", () => {
    assert.isNull(
      findColocatedTests({
        files: ["api/src/errors.ts", "api/src/does-not-exist-for-coverage.ts"],
        packageRoot: join(repoRoot, "api"),
        repoRoot,
      })
    );
  });
});

describe("packageNeedsCompiledDistDeps", () => {
  const repoRoot = resolve(import.meta.dir, "..");

  it("is true when workspace deps publish from dist", () => {
    assert.isTrue(packageNeedsCompiledDistDeps(join(repoRoot, "admin-backend")));
    assert.isTrue(packageNeedsCompiledDistDeps(join(repoRoot, "api")));
  });
});

describe("PACKAGE_CI_LCOV_SKIP", () => {
  it("covers every published package with a coverage CI job", () => {
    assert.include(
      PACKAGE_CI_LCOV_SKIP.map((entry) => entry.packageName),
      "api"
    );
    assert.include(
      PACKAGE_CI_LCOV_SKIP.map((entry) => entry.pipelineParameter),
      "run-jobs"
    );
  });
});

describe("expandCoverageRunArgs", () => {
  const repoRoot = resolve(import.meta.dir, "..");

  it("passes through flags and plain directories untouched", () => {
    assert.deepEqual(
      expandCoverageRunArgs({
        args: ["--max-concurrency=1", "src"],
        packageRoot: join(repoRoot, "api"),
      }),
      ["--max-concurrency=1", "src"]
    );
  });

  it("expands shell globs into real files so a direct bun spawn matches them", () => {
    const expanded = expandCoverageRunArgs({
      args: ["./**/*.test.ts"],
      packageRoot: join(repoRoot, "example-frontend"),
    });
    assert.isTrue(expanded.length > 0, "expected example-frontend unit tests to be found");
    assert.include(expanded, "store/errors.test.ts");
    for (const path of expanded) {
      assert.notInclude(path, "*");
      assert.notInclude(path, "node_modules");
    }
  });
});

describe("workspaceDepsCompileArgs", () => {
  it("points compile-workspace-deps at the gated package", () => {
    const repoRoot = "/repo";
    const packageRoot = "/repo/admin-backend";
    assert.deepEqual(workspaceDepsCompileArgs({packageRoot, repoRoot}), [
      "/repo/.github/scripts/compile-workspace-deps.js",
      "/repo/admin-backend",
    ]);
  });
});
