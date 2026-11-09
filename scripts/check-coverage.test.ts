import {describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  evaluateCoverage,
  formatLcov,
  isBunCoverageThresholdExit,
  listCoveredSourceFiles,
  mergeIsolatedLcov,
  mergeLcov,
  normalizeLcovPath,
  onlyHitFiles,
  parseAllFilesRow,
  parseArgs,
  parseLcov,
  stripAnsi,
  summarizeLcov,
  summaryFromCompleteLcov,
} from "./check-coverage";

const ESC = String.fromCharCode(27);

describe("normalizeLcovPath", () => {
  it("makes absolute paths relative to cwd so isolated and main reports merge", () => {
    expect(normalizeLcovPath("/repo/syncdb/src/client.ts", "/repo/syncdb")).toBe("src/client.ts");
    expect(normalizeLcovPath("src/client.ts", "/repo/syncdb")).toBe("src/client.ts");
  });
});

describe("parseArgs", () => {
  it("defaults to 95 when no flags are passed", () => {
    expect(parseArgs([])).toEqual({threshold: 95});
  });

  it("parses an integer threshold", () => {
    expect(parseArgs(["--threshold=80"])).toEqual({threshold: 80});
  });

  it("parses a fractional threshold", () => {
    expect(parseArgs(["--threshold=92.5"])).toEqual({threshold: 92.5});
  });

  it("ignores unrelated flags", () => {
    expect(parseArgs(["--foo", "bar", "--threshold=50"])).toEqual({threshold: 50});
  });

  it("keeps the last value when the flag appears multiple times", () => {
    expect(parseArgs(["--threshold=70", "--threshold=85"])).toEqual({threshold: 85});
  });
});

describe("stripAnsi", () => {
  it("returns the input unchanged when there are no escape codes", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("removes common color escape sequences", () => {
    const coloured = `${ESC}[31mred${ESC}[0m and ${ESC}[1;32mbold green${ESC}[0m`;
    expect(stripAnsi(coloured)).toBe("red and bold green");
  });
});

describe("parseAllFilesRow", () => {
  const buildReport = (funcPct: string, linePct: string): string =>
    [
      "-------------------|---------|---------|-------------------",
      "File               | % Funcs | % Lines | Uncovered Line #s",
      "-------------------|---------|---------|-------------------",
      `All files          |  ${funcPct} |  ${linePct} |`,
      " foo.ts            |  100.00 |  100.00 |",
      "-------------------|---------|---------|-------------------",
    ].join("\n");

  it("parses the function and line coverage from a plain report", () => {
    expect(parseAllFilesRow(buildReport("95.95", "96.13"))).toEqual({
      functions: 95.95,
      lines: 96.13,
    });
  });

  it("parses the coverage row when the report contains ANSI colour codes", () => {
    const coloured = buildReport(`${ESC}[32m100.00${ESC}[0m`, `${ESC}[32m100.00${ESC}[0m`);
    expect(parseAllFilesRow(coloured)).toEqual({functions: 100, lines: 100});
  });

  it("returns null when the report does not contain an All files row", () => {
    expect(parseAllFilesRow("nothing to see here")).toBeNull();
  });

  it("returns null when the All files row is malformed", () => {
    expect(parseAllFilesRow("All files | not-a-number | not-a-number |")).toBeNull();
  });
});

describe("isBunCoverageThresholdExit", () => {
  it("ignores bun 1.4+ coverage-threshold exits when every test passed", () => {
    expect(
      isBunCoverageThresholdExit(
        1,
        [
          " 466 pass",
          " 0 fail",
          " 1 error",
          "All files                                    |   80.33 |   82.51 |",
        ].join("\n")
      )
    ).toBe(true);
  });

  it("does not ignore a real test failure", () => {
    expect(isBunCoverageThresholdExit(1, " 1 fail\nAll files | 100.00 | 100.00 |")).toBe(false);
  });

  it("does not ignore a crash with no coverage table", () => {
    expect(isBunCoverageThresholdExit(1, " 0 fail\nerror: script exploded")).toBe(false);
  });

  it("returns false when bun already exited 0", () => {
    expect(isBunCoverageThresholdExit(0, " 0 fail\nAll files | 100.00 | 100.00 |")).toBe(false);
  });
});

describe("evaluateCoverage", () => {
  it("returns an empty list when both metrics meet the threshold", () => {
    expect(evaluateCoverage({functions: 95, lines: 95}, 95)).toEqual([]);
    expect(evaluateCoverage({functions: 99, lines: 100}, 95)).toEqual([]);
  });

  it("flags function coverage that is below the threshold", () => {
    expect(evaluateCoverage({functions: 90, lines: 96}, 95)).toEqual([
      {actual: 90, metric: "functions", threshold: 95},
    ]);
  });

  it("flags line coverage that is below the threshold", () => {
    expect(evaluateCoverage({functions: 96, lines: 90}, 95)).toEqual([
      {actual: 90, metric: "lines", threshold: 95},
    ]);
  });

  it("flags both metrics when both are below the threshold", () => {
    expect(evaluateCoverage({functions: 80, lines: 85}, 95)).toEqual([
      {actual: 80, metric: "functions", threshold: 95},
      {actual: 85, metric: "lines", threshold: 95},
    ]);
  });
});

const lcovRecord = ({
  path,
  functions,
  lines,
}: {
  path: string;
  functions: Array<{line: number; name: string; hits: number}>;
  lines: Array<{line: number; hits: number}>;
}): string => {
  const sections: string[] = [`SF:${path}`];
  for (const fn of functions) {
    sections.push(`FN:${fn.line},${fn.name}`);
  }
  for (const fn of functions) {
    sections.push(`FNDA:${fn.hits},${fn.name}`);
  }
  sections.push(`FNF:${functions.length}`);
  sections.push(`FNH:${functions.filter((f) => f.hits > 0).length}`);
  for (const ln of lines) {
    sections.push(`DA:${ln.line},${ln.hits}`);
  }
  sections.push(`LF:${lines.length}`);
  sections.push(`LH:${lines.filter((l) => l.hits > 0).length}`);
  sections.push("end_of_record");
  return sections.join("\n");
};

describe("parseLcov", () => {
  it("records function names with per-function hit counts", () => {
    const text = lcovRecord({
      functions: [
        {hits: 1, line: 1, name: "a"},
        {hits: 0, line: 5, name: "b"},
      ],
      lines: [
        {hits: 3, line: 1},
        {hits: 0, line: 2},
      ],
      path: "src/foo.ts",
    });
    const result = parseLcov(text);
    const entry = result.get("src/foo.ts");
    expect(entry).toBeDefined();
    expect(entry?.hasFnRecords).toBe(true);
    expect(entry?.functions.get("1:a")).toBe(1);
    expect(entry?.functions.get("5:b")).toBe(0);
    expect(entry?.lines.get(1)).toBe(3);
    expect(entry?.lines.get(2)).toBe(0);
  });

  it("disambiguates multiple FN records that share a name", () => {
    const text = [
      "SF:src/bar.ts",
      "FN:1,<anonymous>",
      "FN:1,<anonymous>",
      "FNDA:2,<anonymous>",
      "FNDA:0,<anonymous>",
      "end_of_record",
    ].join("\n");
    const result = parseLcov(text);
    const entry = result.get("src/bar.ts");
    expect(entry).toBeDefined();
    expect(entry?.functions.size).toBe(2);
    expect(entry?.functions.get("1:<anonymous>")).toBe(2);
    expect(entry?.functions.get("1:<anonymous>#2")).toBe(0);
  });

  it("ignores records without a current file", () => {
    const result = parseLcov("DA:1,1\nFN:1,orphan\nend_of_record\n");
    expect(result.size).toBe(0);
  });
});

describe("onlyHitFiles", () => {
  it("drops LCOV records that have no executed lines or functions", () => {
    const coverage = parseLcov(
      [
        lcovRecord({
          functions: [{hits: 0, line: 1, name: "dead"}],
          lines: [{hits: 0, line: 1}],
          path: "src/untouched.ts",
        }),
        lcovRecord({
          functions: [{hits: 1, line: 1, name: "live"}],
          lines: [{hits: 3, line: 1}],
          path: "src/hit.ts",
        }),
      ].join("\n")
    );
    const pruned = onlyHitFiles(coverage);
    expect([...pruned.keys()]).toEqual(["src/hit.ts"]);
  });
});

describe("mergeLcov", () => {
  it("unions per-function hit counts across runs", () => {
    const a = parseLcov(
      lcovRecord({
        functions: [
          {hits: 1, line: 1, name: "one"},
          {hits: 1, line: 5, name: "two"},
          {hits: 0, line: 9, name: "three"},
        ],
        lines: [{hits: 2, line: 1}],
        path: "src/foo.ts",
      })
    );
    const b = parseLcov(
      lcovRecord({
        functions: [
          {hits: 0, line: 1, name: "one"},
          {hits: 0, line: 5, name: "two"},
          {hits: 4, line: 9, name: "three"},
        ],
        lines: [{hits: 5, line: 1}],
        path: "src/foo.ts",
      })
    );
    const merged = mergeLcov(new Map(), a);
    mergeLcov(merged, b);
    const entry = merged.get("src/foo.ts");
    expect(entry).toBeDefined();
    expect(entry?.functions.get("1:one")).toBe(1);
    expect(entry?.functions.get("5:two")).toBe(1);
    expect(entry?.functions.get("9:three")).toBe(4);
    expect(entry?.lines.get(1)).toBe(5);
  });

  it("prefers the isolated snapshot when it executed more lines", () => {
    const main = parseLcov(
      lcovRecord({
        functions: [{hits: 1, line: 1, name: "start"}],
        lines: [
          {hits: 1, line: 1},
          {hits: 0, line: 2},
          {hits: 0, line: 3},
        ],
        path: "src/mongo.ts",
      })
    );
    const isolated = parseLcov(
      lcovRecord({
        functions: [{hits: 1, line: 1, name: "start"}],
        lines: [
          {hits: 1, line: 10},
          {hits: 1, line: 11},
        ],
        path: "src/mongo.ts",
      })
    );
    mergeIsolatedLcov(main, isolated);
    expect(summarizeLcov(main)).toEqual({functions: 100, lines: 100});
  });

  it("does not keep the main suite's unhit functions when adopting an isolated snapshot", () => {
    const main = parseLcov(
      lcovRecord({
        functions: [
          {hits: 0, line: 1, name: "web"},
          {hits: 0, line: 40, name: "native"},
        ],
        lines: [
          {hits: 0, line: 1},
          {hits: 0, line: 2},
          {hits: 0, line: 3},
        ],
        path: "src/pdf.ts",
      })
    );
    const isolated = parseLcov(
      lcovRecord({
        functions: [{hits: 1, line: 10, name: "web"}],
        lines: [
          {hits: 1, line: 10},
          {hits: 1, line: 11},
        ],
        path: "src/pdf.ts",
      })
    );
    mergeIsolatedLcov(main, isolated);
    expect(summarizeLcov(main)).toEqual({functions: 100, lines: 100});
  });

  it("copies files from source when target is missing them", () => {
    const a = parseLcov(
      lcovRecord({
        functions: [{hits: 1, line: 1, name: "fn"}],
        lines: [{hits: 1, line: 1}],
        path: "src/a.ts",
      })
    );
    const b = parseLcov(
      lcovRecord({
        functions: [{hits: 1, line: 1, name: "fn"}],
        lines: [{hits: 1, line: 1}],
        path: "src/b.ts",
      })
    );
    const merged = mergeLcov(new Map(), a);
    mergeLcov(merged, b);
    expect(merged.get("src/a.ts")).toBeDefined();
    expect(merged.get("src/b.ts")).toBeDefined();
  });
});

describe("summarizeLcov", () => {
  it("counts a function as hit once it has non-zero hits in any run", () => {
    const coverage = parseLcov(
      lcovRecord({
        functions: [
          {hits: 1, line: 1, name: "one"},
          {hits: 0, line: 5, name: "two"},
        ],
        lines: [
          {hits: 1, line: 1},
          {hits: 0, line: 2},
        ],
        path: "src/foo.ts",
      })
    );
    expect(summarizeLcov(coverage)).toEqual({functions: 50, lines: 50});
  });

  it("returns 100 for empty coverage to avoid division by zero", () => {
    expect(summarizeLcov(new Map())).toEqual({functions: 100, lines: 100});
  });

  it("merging 1-8 and 6-10 hit sets reports the full union as hit", () => {
    // Regression test: with FN/FNDA records, merging runs that cover different
    // subsets of functions in the same file must take the true union, not the
    // max(FNH) approximation.
    const runA = parseLcov(
      lcovRecord({
        functions: Array.from({length: 10}, (_, idx) => ({
          hits: idx + 1 <= 8 ? 1 : 0,
          line: idx + 1,
          name: `fn${idx + 1}`,
        })),
        lines: [{hits: 1, line: 1}],
        path: "src/file.ts",
      })
    );
    const runB = parseLcov(
      lcovRecord({
        functions: Array.from({length: 10}, (_, idx) => ({
          hits: idx + 1 >= 6 ? 1 : 0,
          line: idx + 1,
          name: `fn${idx + 1}`,
        })),
        lines: [{hits: 1, line: 1}],
        path: "src/file.ts",
      })
    );
    const merged = mergeLcov(new Map(), runA);
    mergeLcov(merged, runB);
    expect(summarizeLcov(merged)).toEqual({functions: 100, lines: 100});
  });

  it("falls back to FNF/FNH aggregates when the LCOV producer omits FN records", () => {
    // Bun 1.3.x emits FNF/FNH but not FN/FNDA. We must still report coverage
    // in that case, even though we can't compute a true cross-run union.
    const text = ["SF:src/foo.ts", "FNF:10", "FNH:7", "DA:1,1", "DA:2,0", "end_of_record"].join(
      "\n"
    );
    const parsed = parseLcov(text);
    expect(parsed.get("src/foo.ts")?.hasFnRecords).toBe(false);
    expect(summarizeLcov(parsed)).toEqual({functions: 70, lines: 50});
  });

  it("prefers FN/FNDA data over aggregates when both are present in the merge target", () => {
    // Once a file picks up FN records from any run, summarize should switch to
    // the per-function path so it reflects the full union.
    const withFn = parseLcov(
      lcovRecord({
        functions: [
          {hits: 1, line: 1, name: "one"},
          {hits: 1, line: 5, name: "two"},
        ],
        lines: [{hits: 1, line: 1}],
        path: "src/foo.ts",
      })
    );
    const aggregateOnly = parseLcov(
      ["SF:src/foo.ts", "FNF:2", "FNH:0", "DA:1,0", "end_of_record"].join("\n")
    );
    const merged = mergeLcov(new Map(), aggregateOnly);
    mergeLcov(merged, withFn);
    expect(merged.get("src/foo.ts")?.hasFnRecords).toBe(true);
    expect(summarizeLcov(merged)).toEqual({functions: 100, lines: 100});
  });
});

describe("summaryFromCompleteLcov", () => {
  const writePackage = (files: Record<string, string>): string => {
    const cwd = mkdtempSync(join(tmpdir(), "coverage-lcov-"));
    for (const [path, contents] of Object.entries(files)) {
      const fullPath = join(cwd, path);
      mkdirSync(join(fullPath, ".."), {recursive: true});
      writeFileSync(fullPath, contents);
    }
    return cwd;
  };

  it("lists non-test source files and skips tests and isolated files", () => {
    const cwd = writePackage({
      "src/asks/schema.ts": "export const schema = 1;\n",
      "src/isolated/hook.isolated.ts": "export const isolated = 1;\n",
      "src/schema.test.ts": "export const test = 1;\n",
      "src/tests/askFixtures.ts": "export const fixture = 1;\n",
    });
    try {
      expect(listCoveredSourceFiles(cwd)).toEqual(["src/asks/schema.ts"]);
    } finally {
      rmSync(cwd, {force: true, recursive: true});
    }
  });

  it("summarizes a report that names every source file", () => {
    const cwd = writePackage({
      "coverage/lcov.info": [
        "SF:src/asks/schema.ts",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "end_of_record",
        "",
      ].join("\n"),
      "src/asks/schema.ts": "export const schema = 1;\n",
    });
    try {
      expect(summaryFromCompleteLcov(cwd)).toEqual({functions: 100, lines: 100});
    } finally {
      rmSync(cwd, {force: true, recursive: true});
    }
  });

  it("returns null when a source file is missing from the report", () => {
    const cwd = writePackage({
      "coverage/lcov.info": ["SF:src/asks/schema.ts", "DA:1,1", "end_of_record", ""].join("\n"),
      "src/asks/schema.ts": "export const schema = 1;\n",
      "src/other.ts": "export const other = 1;\n",
    });
    try {
      expect(summaryFromCompleteLcov(cwd)).toBeNull();
    } finally {
      rmSync(cwd, {force: true, recursive: true});
    }
  });

  it("returns null when the report is missing", () => {
    const cwd = writePackage({"src/asks/schema.ts": "export const schema = 1;\n"});
    try {
      expect(summaryFromCompleteLcov(cwd)).toBeNull();
    } finally {
      rmSync(cwd, {force: true, recursive: true});
    }
  });
});

describe("formatLcov", () => {
  it("round-trips line hits so Codecov can read the merged report", () => {
    const original = parseLcov(
      lcovRecord({
        functions: [
          {hits: 3, line: 4, name: "alpha"},
          {hits: 0, line: 8, name: "beta"},
        ],
        lines: [
          {hits: 2, line: 4},
          {hits: 0, line: 8},
        ],
        path: "src/mod.ts",
      })
    );
    const rendered = formatLcov(original);
    const parsed = parseLcov(rendered);
    expect(summarizeLcov(parsed)).toEqual(summarizeLcov(original));
    expect(parsed.get("src/mod.ts")?.lines.get(4)).toBe(2);
    expect(parsed.get("src/mod.ts")?.lines.get(8)).toBe(0);
  });

  it("emits FNF/FNH when FN records are absent", () => {
    const parsed = parseLcov(
      ["SF:src/foo.ts", "FNF:10", "FNH:7", "DA:1,1", "DA:2,0", "end_of_record"].join("\n")
    );
    const rendered = formatLcov(parsed);
    expect(rendered).toContain("FNF:10");
    expect(rendered).toContain("FNH:7");
    expect(rendered).toContain("DA:1,1");
  });
});
