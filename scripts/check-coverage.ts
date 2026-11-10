#!/usr/bin/env bun
/**
 * Runs `bun test --coverage` in the working directory and fails with a
 * non-zero exit code if either the function or line coverage is below the
 * threshold.
 *
 * Bun 1.4.2+ can fail the test process when bunfig `coverageThreshold` uses the
 * per-metric table form (`{ line = 95, function = 95 }`). Isolated packages
 * merge several LCOV passes, so that first-process exit is below the real
 * union. This script continues when tests reported `0 fail` and an All files
 * table, then enforces the 95% gate on the merged report. See
 * https://github.com/oven-sh/bun/issues/7367.
 *
 * When the package contains tests named `*.isolated.ts` or `*.isolated.tsx`
 * anywhere under `src/`, each
 * isolated test file is run in its own `bun test` invocation (because those
 * tests rely on module-level `mock.module` calls that leak across files and
 * would otherwise pollute unrelated suites). The resulting LCOV coverage
 * reports are merged (only files with hits from an isolated pass) so the
 * reported percentage reflects the union of executed code.
 *
 * `@terreno/blocks` runs this coverage pass with `--max-concurrency=1`.
 * On a 2-vCPU CircleCI worker, Bun's default 20-way run exits 0 before the
 * All files row while the last file is still printing. After one retry, a
 * missing table is accepted when `coverage/lcov.info` lists every non-test
 * source file under `src/`.
 *
 * The main pass runs as concurrent `bun test --shard` processes (count from
 * `TERRENO_TEST_SHARDS`, default half the cores, at most 4). Each shard writes
 * its own LCOV report and the union is gated, the same way isolated passes are
 * merged. Isolated files run in a pool of the same size. Line coverage merges
 * exactly. Bun's LCOV has no per-function records, so a file's merged function
 * figure (largest hit count over largest found count) is an estimate, usually
 * low. A sharded run that misses the threshold is re-run unsplit before it
 * fails. See docs/explanation/test-sharding.md.
 *
 * Usage:
 *   bun run ../scripts/check-coverage.ts [--threshold=95]
 */
import {spawn} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {availableParallelism} from "node:os";
import {basename, isAbsolute, join, relative, resolve} from "node:path";

import {
  findIsolatedFiles,
  formatShardSummary,
  isolatedFileEnv,
  resolveShardCount,
  runPool,
  runShards,
} from "./ci/testShards/lib";

export interface ParsedArgs {
  threshold: number;
}

export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  let threshold = 95;
  for (const arg of argv) {
    const match = arg.match(/^--threshold=(\d+(?:\.\d+)?)$/);
    if (match) {
      threshold = Number(match[1]);
    }
  }
  return {threshold};
};

const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

export const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, "");

/**
 * Bun 1.4.2+ can exit 1 for bunfig coverageThreshold even when every test
 * passed. Isolated packages still need later LCOV merges, so treat that as
 * non-fatal when the summary shows 0 fail and an All files table.
 */
export const isBunCoverageThresholdExit = (exitCode: number, output: string): boolean => {
  if (exitCode === 0) {
    return false;
  }
  const cleaned = stripAnsi(output);
  if (!/\b0 fail\b/.test(cleaned)) {
    return false;
  }
  return /\bAll files\b/.test(cleaned);
};

const failIfTestsFailed = (exitCode: number, output: string, label: string): void => {
  if (exitCode === 0 || isBunCoverageThresholdExit(exitCode, output)) {
    return;
  }
  console.error(`\n${label} exited with code ${exitCode}`);
  process.exit(exitCode);
};

export interface CoverageSummary {
  functions: number;
  lines: number;
}

export const parseAllFilesRow = (output: string): CoverageSummary | null => {
  const cleaned = stripAnsi(output);
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("All files")) {
      continue;
    }
    const parts = line.split("|").map((segment) => segment.trim());
    if (parts.length < 3) {
      continue;
    }
    const functions = Number(parts[1]);
    const lines = Number(parts[2]);
    if (Number.isFinite(functions) && Number.isFinite(lines)) {
      return {functions, lines};
    }
  }
  return null;
};

export interface CoverageFailure {
  metric: "functions" | "lines";
  actual: number;
  threshold: number;
}

export const evaluateCoverage = (
  summary: CoverageSummary,
  threshold: number
): CoverageFailure[] => {
  const failures: CoverageFailure[] = [];
  if (summary.functions < threshold) {
    failures.push({actual: summary.functions, metric: "functions", threshold});
  }
  if (summary.lines < threshold) {
    failures.push({actual: summary.lines, metric: "lines", threshold});
  }
  return failures;
};

export interface FileCoverage {
  /** line number -> max observed hit count across runs */
  lines: Map<number, number>;
  /**
   * Per-function hit counts, keyed by `<line>:<name>`. Only populated when the
   * LCOV producer emits `FN:`/`FNDA:` records. When present, the union of hit
   * functions across merged runs is exact; when absent (e.g. Bun 1.3.x, which
   * only writes FNF/FNH aggregates), we fall back to `functionsFound` /
   * `functionsHit`.
   */
  functions: Map<string, number>;
  /** Max "functions found" across merged runs; fallback when FN records absent. */
  functionsFound: number;
  /** Max "functions hit" across merged runs; fallback when FNDA records absent. */
  functionsHit: number;
  /** True when at least one merged run emitted FN records for this file. */
  hasFnRecords: boolean;
}

const disambiguateKey = (key: string, functions: Map<string, number>): string => {
  if (!functions.has(key)) {
    return key;
  }
  let suffix = 2;
  while (functions.has(`${key}#${suffix}`)) {
    suffix += 1;
  }
  return `${key}#${suffix}`;
};

const createFileCoverage = (): FileCoverage => ({
  functions: new Map(),
  functionsFound: 0,
  functionsHit: 0,
  hasFnRecords: false,
  lines: new Map(),
});

export const normalizeLcovPath = (filePath: string, cwd: string): string => {
  const posix = filePath.replaceAll("\\", "/");
  if (isAbsolute(filePath)) {
    return relative(cwd, filePath).replaceAll("\\", "/");
  }
  return posix;
};

export const parseLcov = (text: string, cwd: string = process.cwd()): Map<string, FileCoverage> => {
  const result = new Map<string, FileCoverage>();
  let current: FileCoverage | null = null;
  // FN records come before FNDA. Anonymous functions can share a name, so we
  // map the printed name -> ordered list of unique keys, and consume them in
  // order as FNDA records are encountered.
  let nameToKeys: Map<string, string[]> | null = null;
  let fndaIndex: Map<string, number> | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const path = normalizeLcovPath(line.slice(3), cwd);
      current = result.get(path) ?? createFileCoverage();
      result.set(path, current);
      nameToKeys = new Map();
      fndaIndex = new Map();
      continue;
    }
    if (!current || !nameToKeys || !fndaIndex) {
      continue;
    }
    if (line.startsWith("DA:")) {
      const [lineNo, hits] = line.slice(3).split(",").map(Number);
      if (Number.isFinite(lineNo) && Number.isFinite(hits)) {
        const prev = current.lines.get(lineNo);
        if (prev === undefined || hits > prev) {
          current.lines.set(lineNo, hits);
        }
      }
      continue;
    }
    if (line.startsWith("FN:")) {
      // FN:<line>,<name>
      const rest = line.slice(3);
      const commaIndex = rest.indexOf(",");
      if (commaIndex < 0) {
        continue;
      }
      const lineNo = rest.slice(0, commaIndex);
      const name = rest.slice(commaIndex + 1);
      const key = disambiguateKey(`${lineNo}:${name}`, current.functions);
      current.functions.set(key, current.functions.get(key) ?? 0);
      current.hasFnRecords = true;
      const keys = nameToKeys.get(name) ?? [];
      keys.push(key);
      nameToKeys.set(name, keys);
      continue;
    }
    if (line.startsWith("FNDA:")) {
      // FNDA:<hits>,<name>
      const rest = line.slice(5);
      const commaIndex = rest.indexOf(",");
      if (commaIndex < 0) {
        continue;
      }
      const hits = Number(rest.slice(0, commaIndex));
      const name = rest.slice(commaIndex + 1);
      if (!Number.isFinite(hits)) {
        continue;
      }
      const keys = nameToKeys.get(name);
      if (!keys || keys.length === 0) {
        continue;
      }
      const idx = fndaIndex.get(name) ?? 0;
      const key = keys[Math.min(idx, keys.length - 1)];
      fndaIndex.set(name, idx + 1);
      const prev = current.functions.get(key) ?? 0;
      if (hits > prev) {
        current.functions.set(key, hits);
      }
      continue;
    }
    if (line.startsWith("FNF:")) {
      const n = Number(line.slice(4));
      if (Number.isFinite(n) && n > current.functionsFound) {
        current.functionsFound = n;
      }
      continue;
    }
    if (line.startsWith("FNH:")) {
      const n = Number(line.slice(4));
      if (Number.isFinite(n) && n > current.functionsHit) {
        current.functionsHit = n;
      }
      continue;
    }
    if (line === "end_of_record") {
      current = null;
      nameToKeys = null;
      fndaIndex = null;
    }
  }
  return result;
};

export const coverageHasHits = (entry: FileCoverage): boolean => {
  for (const hits of entry.lines.values()) {
    if (hits > 0) {
      return true;
    }
  }
  for (const hits of entry.functions.values()) {
    if (hits > 0) {
      return true;
    }
  }
  return entry.functionsHit > 0;
};

/** Isolated bun test LCOV lists untouched project files at 0%; merging those would dilute. */
export const onlyHitFiles = (coverage: Map<string, FileCoverage>): Map<string, FileCoverage> => {
  const next = new Map<string, FileCoverage>();
  for (const [path, entry] of coverage) {
    if (coverageHasHits(entry)) {
      next.set(path, entry);
    }
  }
  return next;
};

export const countHitLines = (entry: FileCoverage): number => {
  let hit = 0;
  for (const hits of entry.lines.values()) {
    if (hits > 0) {
      hit += 1;
    }
  }
  return hit;
};

/**
 * Isolated runs often instrument a different line set than the main suite
 * (different preload, fewer files loaded). Union-by-line-number then leaves
 * the main file's uncovered lines in place and does not get credit for the
 * isolated run's executed lines. Union per line and per function (max hits).
 */
const mergeFunctionAggregates = (existing: FileCoverage, src: FileCoverage): void => {
  const foundA = existing.functionsFound;
  const foundB = src.functionsFound;
  const mergedFound =
    foundA > 0 && foundB > 0 ? Math.min(foundA, foundB) : Math.max(foundA, foundB);
  const mergedHit = Math.min(mergedFound, Math.max(existing.functionsHit, src.functionsHit));
  existing.functionsFound = mergedFound;
  existing.functionsHit = mergedHit;
};

/**
 * Bun sometimes emits FNF/FNH aggregates where FNF counts more arrow bodies than
 * FNH reports as hit, while every instrumented line executed. Align aggregates
 * with line reality so merged gates do not contradict full line coverage.
 */
const alignFunctionAggregatesWhenAllLinesHit = (entry: FileCoverage): void => {
  if (entry.hasFnRecords || entry.lines.size === 0) {
    return;
  }
  for (const hits of entry.lines.values()) {
    if (hits === 0) {
      return;
    }
  }
  entry.functionsHit = entry.functionsFound;
};

export const mergeIsolatedLcov = (
  target: Map<string, FileCoverage>,
  source: Map<string, FileCoverage>
): Map<string, FileCoverage> => {
  for (const [path, src] of source.entries()) {
    if (path.includes(".isolated.")) {
      continue;
    }
    const existing = target.get(path);
    if (!existing) {
      mergeLcov(target, new Map([[path, src]]));
      continue;
    }
    const lineNos = new Set([...existing.lines.keys(), ...src.lines.keys()]);
    for (const lineNo of lineNos) {
      const hits = Math.max(existing.lines.get(lineNo) ?? 0, src.lines.get(lineNo) ?? 0);
      existing.lines.set(lineNo, hits);
    }
    for (const [name, hits] of src.functions.entries()) {
      const prev = existing.functions.get(name) ?? 0;
      if (hits > prev) {
        existing.functions.set(name, hits);
      }
    }
    mergeFunctionAggregates(existing, src);
    alignFunctionAggregatesWhenAllLinesHit(existing);
    if (src.hasFnRecords) {
      existing.hasFnRecords = true;
    }
  }
  return target;
};

export const mergeLcov = (
  target: Map<string, FileCoverage>,
  source: Map<string, FileCoverage>
): Map<string, FileCoverage> => {
  for (const [path, src] of source.entries()) {
    const existing = target.get(path);
    if (!existing) {
      target.set(path, {
        functions: new Map(src.functions),
        functionsFound: src.functionsFound,
        functionsHit: src.functionsHit,
        hasFnRecords: src.hasFnRecords,
        lines: new Map(src.lines),
      });
      continue;
    }
    for (const [name, hits] of src.functions.entries()) {
      const prev = existing.functions.get(name) ?? 0;
      if (hits > prev) {
        existing.functions.set(name, hits);
      }
    }
    if (src.functionsFound > existing.functionsFound) {
      existing.functionsFound = src.functionsFound;
    }
    if (src.functionsHit > existing.functionsHit) {
      existing.functionsHit = src.functionsHit;
    }
    if (src.hasFnRecords) {
      existing.hasFnRecords = true;
    }
    for (const [lineNo, hits] of src.lines.entries()) {
      const prev = existing.lines.get(lineNo) ?? 0;
      if (hits > prev) {
        existing.lines.set(lineNo, hits);
      }
    }
  }
  return target;
};

const functionRatio = (entry: FileCoverage): number =>
  entry.functionsFound === 0 ? 1 : entry.functionsHit / entry.functionsFound;

/**
 * Averages each file's percentages, the way Bun computes the "All files" row of its text
 * table, so a sharded run is gated on the same metric as an unsplit one.
 */
export const summarizeLcovByFile = (coverage: Map<string, FileCoverage>): CoverageSummary => {
  if (coverage.size === 0) {
    return {functions: 100, lines: 100};
  }
  let functions = 0;
  let lines = 0;
  for (const entry of coverage.values()) {
    functions += functionRatio(entry) * 100;
    lines += entry.lines.size === 0 ? 100 : (countHitLines(entry) / entry.lines.size) * 100;
  }
  return {functions: functions / coverage.size, lines: lines / coverage.size};
};

export const summarizeLcov = (coverage: Map<string, FileCoverage>): CoverageSummary => {
  let totalLines = 0;
  let hitLines = 0;
  let totalFns = 0;
  let hitFns = 0;
  for (const entry of coverage.values()) {
    totalLines += entry.lines.size;
    for (const hits of entry.lines.values()) {
      if (hits > 0) {
        hitLines += 1;
      }
    }
    if (entry.hasFnRecords) {
      totalFns += entry.functions.size;
      for (const hits of entry.functions.values()) {
        if (hits > 0) {
          hitFns += 1;
        }
      }
    } else {
      totalFns += entry.functionsFound;
      hitFns += entry.functionsHit;
    }
  }
  return {
    functions: totalFns === 0 ? 100 : (hitFns / totalFns) * 100,
    lines: totalLines === 0 ? 100 : (hitLines / totalLines) * 100,
  };
};

const functionRecordName = (key: string): string => {
  const colon = key.indexOf(":");
  if (colon < 0) {
    return key;
  }
  return key.slice(colon + 1).replace(/#\d+$/, "");
};

const functionRecordLine = (key: string): string => {
  const colon = key.indexOf(":");
  if (colon < 0) {
    return "0";
  }
  return key.slice(0, colon);
};

/** Serialize merged coverage so Codecov (and local KEEP_COVERAGE) can read one report. */
export const formatLcov = (coverage: Map<string, FileCoverage>): string => {
  const blocks: string[] = [];
  const paths = [...coverage.keys()].sort();
  for (const path of paths) {
    const entry = coverage.get(path);
    if (!entry) {
      continue;
    }
    const lines: string[] = [`SF:${path}`];
    if (entry.hasFnRecords && entry.functions.size > 0) {
      for (const key of entry.functions.keys()) {
        lines.push(`FN:${functionRecordLine(key)},${functionRecordName(key)}`);
      }
      for (const [key, hits] of entry.functions.entries()) {
        lines.push(`FNDA:${hits},${functionRecordName(key)}`);
      }
      let hitFns = 0;
      for (const hits of entry.functions.values()) {
        if (hits > 0) {
          hitFns += 1;
        }
      }
      lines.push(`FNF:${entry.functions.size}`);
      lines.push(`FNH:${hitFns}`);
    } else {
      lines.push(`FNF:${entry.functionsFound}`);
      lines.push(`FNH:${entry.functionsHit}`);
    }
    const sortedLineNos = [...entry.lines.keys()].sort((a, b) => a - b);
    for (const lineNo of sortedLineNos) {
      lines.push(`DA:${lineNo},${entry.lines.get(lineNo) ?? 0}`);
    }
    lines.push(`LF:${entry.lines.size}`);
    lines.push(`LH:${countHitLines(entry)}`);
    lines.push("end_of_record");
    blocks.push(lines.join("\n"));
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n")}\n`;
};

export const writeMergedLcov = (cwd: string, coverage: Map<string, FileCoverage>): string => {
  const coverageDir = join(cwd, "coverage");
  mkdirSync(coverageDir, {recursive: true});
  const lcovPath = join(coverageDir, "lcov.info");
  writeFileSync(lcovPath, formatLcov(coverage));
  return lcovPath;
};

/** `bun test` arguments every coverage pass in this package needs before its own. */
const baseBunTestArgs = (args: readonly string[], workingDirectory: string): string[] => {
  const srcRoot = join(workingDirectory, "src");
  const prependSrcRoot =
    existsSync(srcRoot) &&
    !args.some((a) => a.startsWith("./") || /[/\\][^/\\]+\.test\.(t|j)sx?$/.test(a));
  const srcRootArg = prependSrcRoot ? (["src"] as const) : [];
  // Do not pass CLI --path-ignore-patterns: Bun replaces bunfig.toml [test]
  // pathIgnorePatterns (and can drop preload) instead of merging.

  // mcp-server: TERRENO_MCP_DOCS_DIR races across files.
  // admin-frontend: mock.module doubles leak across concurrently loaded files.
  // blocks: the default 20-way coverage run exits 0 on a 2-vCPU worker before
  // the All files row, while the last file is still running.
  const serialPackage = ["mcp-server", "admin-frontend", "blocks"].includes(
    basename(workingDirectory)
  );
  const mcpServerConcurrency = serialPackage ? (["--max-concurrency=1"] as const) : [];
  return [...mcpServerConcurrency, ...srcRootArg, ...args];
};

const runBunTest = async (
  args: readonly string[],
  options?: {env?: Record<string, string>; isBuffered?: boolean; workingDirectory?: string}
): Promise<{exitCode: number; output: string}> => {
  const workingDirectory = options?.workingDirectory ?? process.cwd();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["test", ...baseBunTestArgs(args, workingDirectory)], {
      cwd: workingDirectory,
      env: {...process.env, ...options?.env, FORCE_COLOR: "0"},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (!options?.isBuffered) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (!options?.isBuffered) {
        process.stderr.write(text);
      }
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({exitCode: code ?? 1, output});
    });
  });
};

/** True when Bun reported that this shard was assigned no test files. */
export const isEmptyShardOutput = (output: string): boolean =>
  /--shard=\d+\/\d+: running 0\/\d+ test files?/.test(stripAnsi(output));

/**
 * Runs the main suite as `total` concurrent coverage shards and returns the union of their
 * LCOV reports. Exits when a shard's tests fail.
 */
const runShardedCoverage = async ({
  cwd,
  dirPrefix,
  total,
}: {
  cwd: string;
  dirPrefix: string;
  total: number;
}): Promise<{coverage: Map<string, FileCoverage>; coverageDirs: string[]}> => {
  const dirFor = (index: number): string => resolve(cwd, `${dirPrefix}-shard-${index}`);
  const coverageDirs = Array.from({length: total}, (_, offset) => dirFor(offset + 1));
  for (const dir of coverageDirs) {
    rmSync(dir, {force: true, recursive: true});
  }
  const {results} = await runShards({
    argsForShard: (index) =>
      baseBunTestArgs(
        [
          "--coverage",
          "--coverage-reporter=text",
          "--coverage-reporter=lcov",
          `--coverage-dir=${dirFor(index)}`,
        ],
        cwd
      ),
    cwd,
    env: {...process.env, FORCE_COLOR: "0"},
    total,
  });
  console.info(`\n${formatShardSummary({results}).text}`);
  for (const result of results) {
    failIfTestsFailed(result.exitCode, result.output, `bun test --shard=${result.index}/${total}`);
  }
  const coverage = new Map<string, FileCoverage>();
  for (const result of results) {
    const dir = dirFor(result.index);
    // An empty shard writes no report. Any other shard without one would drop its files from
    // the merged numbers and let the gate pass on partial data.
    if (!existsSync(join(dir, "lcov.info")) && !isEmptyShardOutput(result.output)) {
      console.error(`\nShard ${result.index}/${total} wrote no LCOV report at ${dir}.`);
      process.exit(1);
    }
    mergeLcov(coverage, readLcov(dir, cwd));
  }
  return {coverage, coverageDirs};
};

const readLcov = (coverageDir: string, cwd: string = process.cwd()): Map<string, FileCoverage> => {
  const lcovPath = join(coverageDir, "lcov.info");
  if (!existsSync(lcovPath)) {
    return new Map();
  }
  return parseLcov(readFileSync(lcovPath, "utf8"), cwd);
};

const isCoveredSourceFile = (name: string): boolean => {
  if (!name.endsWith(".ts") && !name.endsWith(".tsx")) {
    return false;
  }
  if (name.includes(".test.") || name.includes(".isolated.")) {
    return false;
  }
  return true;
};

/** Non-test source files the coverage gate expects to see in an LCOV report. */
export const listCoveredSourceFiles = (cwd: string): string[] => {
  const srcDir = join(cwd, "src");
  if (!existsSync(srcDir)) {
    return [];
  }
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.isDirectory()) {
        if (entry.name === "tests") {
          continue;
        }
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !isCoveredSourceFile(entry.name)) {
        continue;
      }
      files.push(relative(cwd, join(dir, entry.name)).replaceAll("\\", "/"));
    }
  };
  walk(srcDir);
  return files.sort();
};

/**
 * Summarize `coverage/lcov.info` when it names every non-test source file.
 * A truncated text table can still leave a complete LCOV report. An incomplete
 * report returns null so the gate does not invent a percentage.
 */
export const summaryFromCompleteLcov = (cwd: string): CoverageSummary | null => {
  const coverage = readLcov(resolve(cwd, "coverage"), cwd);
  if (coverage.size === 0) {
    return null;
  }
  const covered = new Set(coverage.keys());
  const missing = listCoveredSourceFiles(cwd).filter((file) => !covered.has(file));
  if (missing.length > 0) {
    return null;
  }
  return summarizeLcov(coverage);
};

/**
 * Runs every coverage pass for the package and returns the gated summary. With more than one
 * shard the line figure is exact and the function figure is an estimate.
 */
const measureCoverage = async ({
  cwd,
  isolated,
  shardTotal,
}: {
  cwd: string;
  isolated: readonly string[];
  shardTotal: number;
}): Promise<CoverageSummary> => {
  if (isolated.length === 0 && shardTotal > 1) {
    const {coverage, coverageDirs} = await runShardedCoverage({
      cwd,
      dirPrefix: "coverage",
      total: shardTotal,
    });
    rmSync(resolve(cwd, "coverage"), {force: true, recursive: true});
    writeMergedLcov(cwd, coverage);
    if (!process.env.KEEP_COVERAGE) {
      for (const dir of coverageDirs) {
        rmSync(dir, {force: true, recursive: true});
      }
    }
    // Same metric as the "All files" row an unsplit run is gated on.
    return summarizeLcovByFile(coverage);
  }

  if (isolated.length === 0) {
    const coverageDir = resolve(cwd, "coverage");
    const coverageArgs = [
      "--coverage",
      "--coverage-reporter=text",
      "--coverage-reporter=lcov",
      `--coverage-dir=${coverageDir}`,
    ] as const;
    const runCoverage = async (): Promise<{exitCode: number; output: string}> => {
      rmSync(coverageDir, {force: true, recursive: true});
      return runBunTest(coverageArgs);
    };
    let run = await runCoverage();
    // Bun can close the process with status 0 before it prints the table.
    if (run.exitCode === 0 && !parseAllFilesRow(run.output)) {
      console.error("\nCoverage report was truncated. Retrying bun test --coverage once.");
      run = await runCoverage();
    }
    failIfTestsFailed(run.exitCode, run.output, "bun test");
    const table = parseAllFilesRow(run.output);
    const summary = table ?? summaryFromCompleteLcov(cwd);
    if (!summary) {
      console.error('\nCould not find an "All files" row in the coverage output.');
      process.exit(1);
    }
    if (!table) {
      console.error(
        "\nCoverage text table was missing. Using the LCOV report, which includes every source file."
      );
    }
    return summary;
  }

  console.info(
    `\nFound ${isolated.length} isolated test file(s); running separate coverage passes.\n`
  );

  const mergedCoverage = new Map<string, FileCoverage>();
  const coverageDirs: string[] = [];

  if (shardTotal > 1) {
    const main = await runShardedCoverage({cwd, dirPrefix: "coverage-main", total: shardTotal});
    coverageDirs.push(...main.coverageDirs);
    mergeLcov(mergedCoverage, main.coverage);
  } else {
    const mainDir = resolve(cwd, "coverage-main");
    coverageDirs.push(mainDir);
    rmSync(mainDir, {force: true, recursive: true});

    const mainRun = await runBunTest([
      "--coverage",
      "--coverage-reporter=text",
      "--coverage-reporter=lcov",
      `--coverage-dir=${mainDir}`,
    ]);
    failIfTestsFailed(mainRun.exitCode, mainRun.output, "bun test");
    mergeLcov(mergedCoverage, readLcov(mainDir));
  }

  // Each isolated file is its own process, so a pool runs them without changing what they see.
  const isolatedRuns = await runPool(
    isolated.map((testFile, index) => async () => {
      const dir = resolve(cwd, `coverage-iso-${index}`);
      rmSync(dir, {force: true, recursive: true});
      if (shardTotal === 1) {
        console.info(`\n--- Isolated coverage pass for ${testFile} ---`);
      }
      const run = await runBunTest(
        [testFile, "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${dir}`],
        {
          env: isolatedFileEnv({file: testFile}).env,
          isBuffered: shardTotal > 1,
        }
      );
      if (shardTotal > 1) {
        process.stdout.write(`\n--- Isolated coverage pass for ${testFile} ---\n${run.output}`);
      }
      return {dir, run, testFile};
    }),
    shardTotal
  );
  for (const {dir, run, testFile} of isolatedRuns) {
    coverageDirs.push(dir);
    failIfTestsFailed(run.exitCode, run.output, `bun test ${testFile}`);
    mergeIsolatedLcov(mergedCoverage, onlyHitFiles(readLcov(dir)));
  }

  writeMergedLcov(cwd, mergedCoverage);
  if (!process.env.KEEP_COVERAGE) {
    for (const dir of coverageDirs) {
      rmSync(dir, {force: true, recursive: true});
    }
  }
  return summarizeLcov(mergedCoverage);
};

const main = async (): Promise<void> => {
  const {threshold} = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const isolated = findIsolatedFiles(cwd);
  const {error: shardError, total: shardTotal} = resolveShardCount({
    cpuCount: availableParallelism(),
    env: process.env,
  });
  if (shardError) {
    console.error(shardError);
    process.exit(2);
  }

  let summary = await measureCoverage({cwd, isolated, shardTotal});
  if (shardTotal > 1 && evaluateCoverage(summary, threshold).length > 0) {
    // Bun's LCOV cannot say which functions each shard hit, so the merged function figure is an
    // estimate that usually reads low. Confirm a failure with one unsplit pass.
    console.error(
      `\nSharded coverage is below ${threshold}% ` +
        `(functions=${summary.functions.toFixed(2)}%, lines=${summary.lines.toFixed(2)}%). ` +
        "The sharded function figure is an estimate; re-running unsplit for the exact numbers."
    );
    summary = await measureCoverage({cwd, isolated, shardTotal: 1});
  }
  reportSummary(summary, threshold);
};

const reportSummary = (summary: CoverageSummary, threshold: number): void => {
  console.info(
    `\nCoverage summary: functions=${summary.functions.toFixed(2)}%, ` +
      `lines=${summary.lines.toFixed(2)}% (threshold=${threshold}%)`
  );

  const failures = evaluateCoverage(summary, threshold);
  if (failures.length > 0) {
    const message = failures
      .map((f) => `${f.metric} ${f.actual.toFixed(2)}% < ${f.threshold}%`)
      .join(", ");
    console.error(`\nCoverage below threshold: ${message}`);
    process.exit(1);
  }

  console.info("Coverage meets the minimum threshold.");
};

if (import.meta.main) {
  void main();
}
