import {expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import {
  collectAnyUsages,
  formatSummaryText,
  formatUsageListText,
  inferPackageName,
  isExcludedFromBiome,
  isTestFile,
  runCheckExplicitAny,
  SCAN_ROOTS,
} from "./lib";

const createFixtureRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "terreno-any-check-"));

  mkdirSync(join(root, "api/src"), {recursive: true});
  mkdirSync(join(root, "ui/src"), {recursive: true});

  writeFileSync(
    join(root, "biome.jsonc"),
    JSON.stringify(
      {
        files: {
          includes: ["api/src/**/*.ts", "ui/src/**/*.ts", "!!api/src/populate.ts"],
        },
      },
      null,
      2
    )
  );

  writeFileSync(
    join(root, "api/src/populate.ts"),
    `export const populate = (value: any): any => value;\n`
  );

  writeFileSync(
    join(root, "api/src/documented.ts"),
    `// noExplicitAny: framework boundary
// noExplicitAny: framework boundary
// biome-ignore lint/suspicious/noExplicitAny: framework boundary
export const boundary = (value: any): void => {
  void value;
};
`
  );

  writeFileSync(
    join(root, "api/src/violation.ts"),
    `export const unsafe = (value: any): void => {
  void value;
};
`
  );

  writeFileSync(
    join(root, "ui/src/fileBlanket.ts"),
    `// biome-ignore-all lint/suspicious/noExplicitAny: dynamic UI props
export const render = (props: any): any => props;
`
  );

  writeFileSync(
    join(root, "ui/src/Widget.test.tsx"),
    `// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
export const mock = (value: any): any => value;
`
  );

  return root;
};

test("collectAnyUsages classifies remediation status", () => {
  const root = createFixtureRepo();

  try {
    const summary = collectAnyUsages({
      includeExcluded: true,
      repoRoot: root,
      scanRoots: ["api/src", "ui/src"],
    });

    const byFile = Object.fromEntries(
      summary.usages.map((usage) => [`${usage.file}:${usage.line}`, usage.remediationStatus])
    );

    expect(byFile["api/src/documented.ts:4"]).toBe("fully-documented");
    expect(byFile["api/src/violation.ts:1"]).toBe("violation");
    expect(byFile["api/src/populate.ts:1"]).toBe("out-of-scope");
    expect(byFile["ui/src/fileBlanket.ts:2"]).toBe("file-blanket");
    expect(summary.byRemediationStatus.violation).toBeGreaterThanOrEqual(1);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test("collectAnyUsages filters undocumented suppressions", () => {
  const root = createFixtureRepo();

  try {
    const summary = collectAnyUsages({
      includeExcluded: true,
      repoRoot: root,
      scanRoots: ["api/src", "ui/src"],
      undocumentedOnly: true,
    });

    expect(summary.usages.every((usage) => usage.file !== "api/src/documented.ts")).toBe(true);
    expect(summary.usages.some((usage) => usage.file === "ui/src/fileBlanket.ts")).toBe(true);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test("runCheckExplicitAny fails on violations", () => {
  const root = createFixtureRepo();

  try {
    const result = runCheckExplicitAny({
      includeExcluded: true,
      repoRoot: root,
    });

    expect(result.exitCode).toBe(1);
    expect(result.summary.byRemediationStatus.violation).toBeGreaterThan(0);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test("runCheckExplicitAny can fail on undocumented suppressions", () => {
  const root = createFixtureRepo();

  try {
    const result = runCheckExplicitAny({
      failOnUndocumented: true,
      includeExcluded: true,
      repoRoot: root,
    });

    expect(result.exitCode).toBe(1);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test("runCheckExplicitAny passes strict marker mode for documented suppressions", () => {
  const root = createFixtureRepo();

  try {
    rmSync(join(root, "api/src/violation.ts"));
    rmSync(join(root, "ui/src/fileBlanket.ts"));
    rmSync(join(root, "ui/src/Widget.test.tsx"));

    const result = runCheckExplicitAny({
      failOnUndocumented: true,
      includeExcluded: true,
      repoRoot: root,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.byRemediationStatus["fully-documented"], 1);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test("formatSummaryText includes package breakdown", () => {
  const text = formatSummaryText({
    byPackage: {api: 3, ui: 2},
    byRemediationStatus: {
      "file-blanket": 2,
      "fully-documented": 1,
      "out-of-scope": 0,
      "suppressed-only": 1,
      violation: 1,
    },
    fileBlanketFiles: 1,
    totalFiles: 2,
    totalUsages: 5,
    usages: [],
  });

  expect(text).toContain("check-explicit-any: 5 usages across 2 files");
  expect(text).toContain("api                    3");
  expect(text).toContain("ui                     2");
});

test("inferPackageName maps monorepo paths", () => {
  expect(inferPackageName("api/src/auth.ts")).toBe("api");
  expect(inferPackageName("example-backend/src/server.ts")).toBe("example-backend");
  expect(inferPackageName("admin-spa/store/adminSyncDb.ts")).toBe("admin-spa");
});

test("isTestFile detects common test paths", () => {
  expect(isTestFile("api/src/api.test.ts")).toBe(true);
  expect(isTestFile("ui/src/isolated/Widget.isolated.tsx")).toBe(true);
  expect(isTestFile("api/src/auth.ts")).toBe(false);
});

test("formatUsageListText prints file locations", () => {
  const text = formatUsageListText({
    byPackage: {},
    byRemediationStatus: {
      "file-blanket": 1,
      "fully-documented": 0,
      "out-of-scope": 0,
      "suppressed-only": 0,
      violation: 0,
    },
    fileBlanketFiles: 1,
    totalFiles: 1,
    totalUsages: 1,
    usages: [
      {
        column: 18,
        file: "ui/src/Common.ts",
        hasBiomeIgnore: true,
        hasNoExplicitAnyComment: false,
        isExcludedFromBiome: false,
        isTestFile: false,
        kind: "annotation",
        line: 535,
        packageName: "ui",
        remediationStatus: "file-blanket",
        snippet: "[key: string]: any;",
        suppressionScope: "file",
      },
    ],
  });

  expect(text).toContain("ui/src/Common.ts:535:18 annotation file-blanket");
});

test("runCheckExplicitAny supports list output", () => {
  const root = createFixtureRepo();

  try {
    const result = runCheckExplicitAny({
      includeExcluded: true,
      list: true,
      repoRoot: root,
      undocumentedOnly: true,
    });

    expect(result.text).toContain("ui/src/fileBlanket.ts:");
    expect(result.text).toContain("file-blanket");
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test("isExcludedFromBiome matches biome exclusion globs", () => {
  const patterns = [/api\/src\/populate\.ts/];
  expect(isExcludedFromBiome("api/src/populate.ts", patterns)).toBe(true);
  expect(isExcludedFromBiome("api/src/auth.ts", patterns)).toBe(false);
});

test("SCAN_ROOTS includes jobs/src for published backend packages", () => {
  expect(SCAN_ROOTS).toContain("jobs/src");
});
