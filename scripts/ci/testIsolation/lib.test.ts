import {describe, expect, it} from "bun:test";

import {
  addedLinesForNewFile,
  addedLinesFromDiff,
  findIsolationViolations,
  formatIsolationReport,
  isSharedSuiteTestFile,
} from "./lib";

const DIFF = `diff --git a/ui/src/Chart.test.tsx b/ui/src/Chart.test.tsx
index 111..222 100644
--- a/ui/src/Chart.test.tsx
+++ b/ui/src/Chart.test.tsx
@@ -3,0 +4,2 @@ import {describe} from "bun:test";
+mock.module("react-native-svg", () => ({}));
+const value = 1;
@@ -20 +22 @@ describe("Chart", () => {
-  old();
+  mock.module("luxon", () => ({}));
diff --git a/ui/src/Removed.test.tsx b/ui/src/Removed.test.tsx
--- a/ui/src/Removed.test.tsx
+++ /dev/null
@@ -1 +0,0 @@
-mock.module("x", () => ({}));
`;

describe("isSharedSuiteTestFile", () => {
  it("matches test files outside isolated directories", () => {
    expect(isSharedSuiteTestFile("ui/src/Box.test.tsx")).toBe(true);
    expect(isSharedSuiteTestFile("api/src/api.spec.ts")).toBe(true);
    expect(isSharedSuiteTestFile("ui/src/isolated/Box.test.tsx")).toBe(false);
    expect(isSharedSuiteTestFile("ui/src/Box.tsx")).toBe(false);
    expect(isSharedSuiteTestFile("admin-frontend/src/Form.isolated.tsx")).toBe(false);
    expect(isSharedSuiteTestFile("scripts/ci/prepush/plan.test.ts")).toBe(false);
  });
});

describe("addedLinesFromDiff", () => {
  it("tracks new-file line numbers across hunks and ignores deleted files", () => {
    const added = addedLinesFromDiff(DIFF);
    expect(added.get("ui/src/Chart.test.tsx")).toEqual([
      {line: 4, text: 'mock.module("react-native-svg", () => ({}));'},
      {line: 5, text: "const value = 1;"},
      {line: 22, text: '  mock.module("luxon", () => ({}));'},
    ]);
    expect(added.has("ui/src/Removed.test.tsx")).toBe(false);
  });
});

describe("findIsolationViolations", () => {
  it("reports added mock.module calls in shared suites", () => {
    const violations = findIsolationViolations({
      addedLines: addedLinesFromDiff(DIFF),
      fileContents: () => undefined,
    });
    expect(violations.map((violation) => violation.line)).toEqual([4, 22]);
  });

  it("allows a call marked isolation-safe on the same or previous line", () => {
    const content = [
      "// isolation-safe: identical to ui/bunSetup.ts",
      'mock.module("a", () => ({}));',
    ].join("\n");
    const addedLines = new Map([["ui/src/A.test.tsx", addedLinesForNewFile(content)]]);
    expect(findIsolationViolations({addedLines, fileContents: () => content})).toEqual([]);
  });

  it("ignores isolated test files", () => {
    const content = 'mock.module("a", () => ({}));';
    const addedLines = new Map([["ui/src/isolated/A.test.tsx", addedLinesForNewFile(content)]]);
    expect(findIsolationViolations({addedLines, fileContents: () => content})).toEqual([]);
  });
});

describe("formatIsolationReport", () => {
  it("names each violation and the fixes", () => {
    const report = formatIsolationReport([
      {line: 4, path: "ui/src/A.test.tsx", text: "mock.module()"},
    ]);
    expect(report).toContain("ui/src/A.test.tsx:4");
    expect(report).toContain("isolation-safe");
  });
});
