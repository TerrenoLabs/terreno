import {describe, test} from "bun:test";
import {assert} from "chai";

import {
  fingerprintKnipReport,
  groupFilesByBiomeDirectory,
  isIsolatedOrRepoScriptTestFile,
  type KnipReport,
  parseChangedFileOutput,
  parseKnipReportStdout,
  selectAnalyzableFiles,
  unusedFilePathsFromKnipReport,
} from "./lib";

describe("static-analysis helpers", (): void => {
  test("parses null-separated Git file output", (): void => {
    assert.deepEqual(parseChangedFileOutput("api/src/a.ts\0ui/src/b.tsx\0"), [
      "api/src/a.ts",
      "ui/src/b.tsx",
    ]);
  });

  test("selects unique existing files supported by Biome", (): void => {
    const files = selectAnalyzableFiles(
      ["README.md", "api/src/a.ts", "api/src/a.ts", "missing.ts", "package.json"],
      (file): boolean => file !== "missing.ts"
    );

    assert.deepEqual(files, ["api/src/a.ts", "package.json"]);
  });

  test("groups files under their nearest workspace Biome config", (): void => {
    const runs = groupFilesByBiomeDirectory({
      doesConfigExist: (path): boolean =>
        path === "/repo/api/biome.jsonc" || path === "/repo/scripts/biome.jsonc",
      files: ["package.json", "api/src/a.ts", "scripts/check.ts"],
      repoRoot: "/repo",
    });

    assert.deepEqual(runs, [
      {cwd: "/repo/api", files: ["src/a.ts"]},
      {cwd: "/repo/scripts", files: ["check.ts"]},
    ]);
  });

  test("parses Knip JSON even when stdout has a leading warning", (): void => {
    const report = parseKnipReportStdout(
      'warn cache locked\n{"issues":[{"file":"src/a.ts","exports":[{"name":"unused"}]}]}'
    );

    assert.deepEqual(report.issues, [{exports: [{name: "unused"}], file: "src/a.ts"}]);
  });

  test("treats a Knip object without issues as an empty report", (): void => {
    assert.deepEqual(parseKnipReportStdout("{}").issues, []);
    assert.deepEqual(
      fingerprintKnipReport({mode: "default", report: {issues: undefined} as KnipReport}),
      []
    );
  });

  test("fingerprints Knip issues without unstable source positions", (): void => {
    const issues = fingerprintKnipReport({
      mode: "default",
      report: {
        issues: [
          {
            exports: [{col: 4, line: 10, name: "unusedExport"}],
            file: "src/example.ts",
            files: [],
          },
        ],
      },
    });

    assert.deepEqual(issues, ["default:exports:src/example.ts:unusedExport"]);
  });

  test("collects unused file paths from a Knip report", (): void => {
    const paths = unusedFilePathsFromKnipReport({
      issues: [
        {
          file: "scripts/static-analysis/lib.test.ts",
          files: [{name: "scripts/static-analysis/lib.test.ts"}],
        },
      ],
    });
    assert.deepEqual(paths, ["scripts/static-analysis/lib.test.ts"]);
  });

  test("classifies isolated suites and repo script tests", (): void => {
    assert.isTrue(
      isIsolatedOrRepoScriptTestFile(
        "syncdb/src/isolated/defaultPersisterFactoryNative.isolated.ts"
      )
    );
    assert.isTrue(isIsolatedOrRepoScriptTestFile("scripts/static-analysis/lib.test.ts"));
    assert.isTrue(
      isIsolatedOrRepoScriptTestFile(".github/scripts/architectural-pr-review.test.ts")
    );
    assert.isFalse(
      isIsolatedOrRepoScriptTestFile("api/src/sync/scripts/compactTombstones.test.ts")
    );
    assert.isFalse(isIsolatedOrRepoScriptTestFile("scripts/static-analysis/full.ts"));
    assert.isFalse(isIsolatedOrRepoScriptTestFile("example-frontend/e2e/login.spec.ts"));
  });
});
