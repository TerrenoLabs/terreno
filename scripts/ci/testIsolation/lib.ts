/**
 * Flags `mock.module` calls a branch adds to shared Bun test suites.
 *
 * `bun test` runs every file of a package in one process, and `mock.module`
 * replaces a module for that whole process; `mock.restore()` does not undo it.
 * A test that mocks a module passes alone and then breaks, or is broken by,
 * other files in the suite, which CI only sees in the full run.
 *
 * Existing calls are grandfathered: only lines added since the base count.
 *
 * Policy: docs/explanation/test-isolation.md
 */

export interface IsolationViolation {
  line: number;
  path: string;
  text: string;
}

/** Test files that share one `bun test` process with the rest of their package. */
export const isSharedSuiteTestFile = (path: string): boolean => {
  if (!/\.(test|spec)\.(ts|tsx)$/.test(path)) {
    return false;
  }
  // Repository tooling tests are not package suites and quote mock.module as data.
  if (path.startsWith("scripts/")) {
    return false;
  }
  return !/(^|\/)isolated\//.test(path) && !path.includes("node_modules/");
};

const MOCK_MODULE = /\bmock\.module\s*\(/;
const ALLOW_MARKER = "isolation-safe:";

/**
 * Parses `git diff --unified=0` output into added lines per file.
 * Untracked files should be passed through `addedLinesForNewFile`.
 */
export const addedLinesFromDiff = (diff: string): Map<string, {line: number; text: string}[]> => {
  const added = new Map<string, {line: number; text: string}[]>();
  let currentPath: string | undefined;
  let nextLine = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      currentPath = target === "/dev/null" ? undefined : target.replace(/^b\//, "");
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (!currentPath || raw.startsWith("--- ")) {
      continue;
    }
    if (raw.startsWith("+")) {
      const lines = added.get(currentPath) ?? [];
      lines.push({line: nextLine, text: raw.slice(1)});
      added.set(currentPath, lines);
      nextLine += 1;
    }
  }
  return added;
};

export const addedLinesForNewFile = (content: string): {line: number; text: string}[] =>
  content.split("\n").map((text, index) => ({line: index + 1, text}));

/**
 * A call is allowed when the same or previous line carries
 * `isolation-safe: <reason>`, e.g. the mock is identical to the package preload.
 */
export const findIsolationViolations = ({
  addedLines,
  fileContents,
}: {
  addedLines: Map<string, {line: number; text: string}[]>;
  fileContents: (path: string) => string | undefined;
}): IsolationViolation[] => {
  const violations: IsolationViolation[] = [];
  for (const [path, lines] of addedLines) {
    if (!isSharedSuiteTestFile(path)) {
      continue;
    }
    const content = fileContents(path)?.split("\n") ?? [];
    for (const {line, text} of lines) {
      if (!MOCK_MODULE.test(text)) {
        continue;
      }
      const previous = content[line - 2] ?? "";
      if (text.includes(ALLOW_MARKER) || previous.includes(ALLOW_MARKER)) {
        continue;
      }
      violations.push({line, path, text: text.trim()});
    }
  }
  return violations;
};

export const formatIsolationReport = (violations: IsolationViolation[]): string => {
  const lines = violations.map(
    (violation) => `  ${violation.path}:${violation.line}  ${violation.text}`
  );
  return [
    `check-test-isolation: ${violations.length} new mock.module call(s) in shared Bun suites:`,
    ...lines,
    "",
    "mock.module replaces the module for every test file in the package run. Fix one of:",
    "  1. Inject the dependency and pass a fake instead of mocking the module.",
    "  2. Move the test to src/isolated/<name>.isolated.ts(x) (packages whose test:coverage",
    "     uses scripts/check-coverage.ts run each isolated file in its own process).",
    "  3. Register the mock once in the package's bun preload so every file agrees.",
    "  4. If the mock matches the preload exactly, add `// isolation-safe: <reason>` above it.",
    "Policy: docs/explanation/test-isolation.md",
  ].join("\n");
};
