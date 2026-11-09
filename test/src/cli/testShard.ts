/**
 * Splits test files into weight-balanced shards and runs one shard with `bun test`.
 *
 * Why: suites that share one database connection run sequentially inside a single Bun worker,
 * so the only way to cut wall-clock time is to run disjoint subsets of files on separate CI
 * machines. Shards are discovered by walking the filesystem, so a newly added test file is
 * always picked up by exactly one shard instead of being silently skipped.
 *
 * Balancing: files are weighted by `lines + linesPerTest * testCount` and assigned heaviest
 * first to the currently lightest shard (longest-processing-time-first). A file's runtime is
 * roughly a fixed cost per test (server setup, auth, transaction open/abort) plus a cost that
 * grows with how much its bodies do; neither term alone is a good proxy.
 *
 * Isolation: `mock.module()` is process-wide in Bun, so files that register (or are victims
 * of) leaking module mocks can be moved into their own `bun test` process with `--isolate`,
 * or every directory/file can get its own process with `--process-per`.
 */
import {readFileSync} from "node:fs";
import path from "node:path";
import {parseArgs} from "node:util";

import {
  collectFiles,
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_TEST_PATTERNS,
  matchesAnyGlob,
} from "./collectFiles";

/** Lines of test code that cost about as much wall time as one test's fixed setup overhead. */
const DEFAULT_LINES_PER_TEST = 50;

const TEST_CALL_PATTERN = /^\s*(it|test)(\.\w+)*\s*\(/gm;

/** Process granularity for the files in one shard. */
const PROCESS_PER = {
  dir: "dir",
  file: "file",
  shard: "shard",
} as const;

export type ProcessPer = (typeof PROCESS_PER)[keyof typeof PROCESS_PER];

interface WeightedFile {
  file: string;
  weight: number;
}

export interface Shard {
  files: string[];
  weight: number;
}

export interface ProcessGroup {
  /** Label for progress and summary output. */
  name: string;
  /** `cwd`-relative POSIX paths run together in one `bun test` process. */
  files: string[];
}

interface ProcessGroupResult {
  group: ProcessGroup;
  success: boolean;
  durationMs: number;
}

export interface RunProcessGroupsOutcome {
  results: ProcessGroupResult[];
  /** Groups never started because an earlier group failed under `failFast`. */
  skipped: ProcessGroup[];
  allPassed: boolean;
}

/** Runs one command to completion and reports its exit code. Injectable for tests. */
export type SpawnCommand = (options: {cmd: string[]; cwd: string}) => {exitCode: number};

export interface CliLogger {
  info: (message: string) => void;
  error: (message: string) => void;
}

/** Counts `it(`/`test(` calls (including `.only`, `.each`, etc.) that start a line. */
export const countTests = ({source}: {source: string}): {testCount: number} => ({
  testCount: (source.match(TEST_CALL_PATTERN) ?? []).length,
});

/** Estimates a file's relative runtime as `lines + linesPerTest * testCount`. */
export const estimateTestWeight = ({
  source,
  linesPerTest = DEFAULT_LINES_PER_TEST,
}: {
  source: string;
  linesPerTest?: number;
}): {weight: number} => {
  const {testCount} = countTests({source});
  return {weight: source.split("\n").length + linesPerTest * testCount};
};

/**
 * Assigns files to `total` shards, heaviest first, always filling the lightest shard next. Ties
 * break on file name and lowest shard index so every CI node computes the same assignment.
 */
export const buildShards = ({files, total}: {files: WeightedFile[]; total: number}): Shard[] => {
  const sorted = [...files].sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  const shards: Shard[] = Array.from({length: total}, () => ({files: [], weight: 0}));
  for (const {file, weight} of sorted) {
    let lightest = 0;
    for (let i = 1; i < shards.length; i++) {
      if (shards[i].weight < shards[lightest].weight) {
        lightest = i;
      }
    }
    shards[lightest].files.push(file);
    shards[lightest].weight += weight;
  }
  for (const shard of shards) {
    shard.files.sort();
  }
  return shards;
};

/** Parses a 1-based `<index>/<total>` shard spec such as `2/4`. */
export const parseShardSpec = ({
  spec,
}: {
  spec: string;
}): {index: number; total: number} | {error: string} => {
  const match = spec.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    return {error: `Invalid shard spec "${spec}"; expected <index>/<total>, e.g. 2/4`};
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || index < 1 || index > total) {
    return {error: `Shard index ${index} is out of range for ${total} shard(s)`};
  }
  return {index, total};
};

const groupKeyForDir = ({file, dirDepth}: {file: string; dirDepth: number}): string => {
  const segments = file.split("/").slice(0, -1);
  if (segments.length === 0) {
    return ".";
  }
  return segments.slice(0, dirDepth).join("/");
};

/**
 * Splits one shard's files into `bun test` processes. Files matching an `isolate` glob always get
 * a process of their own; the rest share one process (`shard`), one per directory prefix of
 * `dirDepth` segments (`dir`), or one each (`file`).
 */
export const planProcessGroups = ({
  files,
  processPer = PROCESS_PER.shard,
  isolate = [],
  dirDepth = 1,
}: {
  files: string[];
  processPer?: ProcessPer;
  isolate?: readonly string[];
  dirDepth?: number;
}): ProcessGroup[] => {
  const isolated = files.filter((file) => matchesAnyGlob({filePath: file, globs: isolate}));
  const isolatedSet = new Set(isolated);
  const shared = files.filter((file) => !isolatedSet.has(file));
  const groups: ProcessGroup[] = [];

  if (processPer === PROCESS_PER.file) {
    groups.push(...shared.map((file) => ({files: [file], name: file})));
  } else if (processPer === PROCESS_PER.dir) {
    const byDir = new Map<string, string[]>();
    for (const file of shared) {
      const key = groupKeyForDir({dirDepth, file});
      byDir.set(key, [...(byDir.get(key) ?? []), file]);
    }
    for (const key of [...byDir.keys()].sort()) {
      groups.push({files: byDir.get(key) ?? [], name: key});
    }
  } else if (shared.length > 0) {
    groups.push({files: shared, name: "shared"});
  }

  groups.push(...isolated.map((file) => ({files: [file], name: `${file} (isolated)`})));
  return groups;
};

/**
 * Builds the `bun test` argv for a group. Paths are `./`-prefixed because Bun treats bare
 * positional arguments as substring filters (a bare `tests` also matches every `__tests__`).
 */
export const buildBunTestCommand = ({
  files,
  bunArgs = [],
}: {
  files: string[];
  bunArgs?: readonly string[];
}): {cmd: string[]} => ({
  cmd: [
    "bun",
    "test",
    ...bunArgs,
    ...files.map((file) => (file.startsWith(".") || path.isAbsolute(file) ? file : `./${file}`)),
  ],
});

const spawnWithBun: SpawnCommand = ({cmd, cwd}) => {
  const proc = Bun.spawnSync({cmd, cwd, stdio: ["inherit", "inherit", "inherit"]});
  return {exitCode: proc.exitCode ?? 1};
};

/** Runs each group in its own `bun test` process, optionally stopping at the first failure. */
export const runProcessGroups = ({
  groups,
  cwd,
  bunArgs = [],
  failFast = false,
  spawn = spawnWithBun,
  logger = console,
}: {
  groups: ProcessGroup[];
  cwd: string;
  bunArgs?: readonly string[];
  failFast?: boolean;
  spawn?: SpawnCommand;
  logger?: CliLogger;
}): RunProcessGroupsOutcome => {
  const results: ProcessGroupResult[] = [];
  for (const group of groups) {
    if (groups.length > 1) {
      logger.info(`\n=== ${group.name} (${group.files.length} file(s)) ===`);
    }
    const start = performance.now();
    const {cmd} = buildBunTestCommand({bunArgs, files: group.files});
    const {exitCode} = spawn({cmd, cwd});
    const success = exitCode === 0;
    results.push({durationMs: performance.now() - start, group, success});
    if (!success && failFast) {
      logger.error(`\n"${group.name}" failed; stopping (--fail-fast).`);
      break;
    }
  }
  const skipped = groups.slice(results.length);
  return {
    allPassed: skipped.length === 0 && results.every((result) => result.success),
    results,
    skipped,
  };
};

/** Formats the PASS/FAIL/SKIP block printed after a multi-process run. */
export const formatRunSummary = ({results, skipped}: RunProcessGroupsOutcome): {text: string} => {
  const lines = ["=== Summary ==="];
  for (const result of results) {
    const status = result.success ? "PASS" : "FAIL";
    lines.push(`${status}  ${result.group.name}  (${(result.durationMs / 1000).toFixed(2)}s)`);
  }
  for (const group of skipped) {
    lines.push(`SKIP  ${group.name}`);
  }
  return {text: lines.join("\n")};
};

/** Reads newline-separated globs, ignoring blank lines and `#` comments. */
export const parseGlobList = ({text}: {text: string}): {globs: string[]} => ({
  globs: text
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0),
});

const TEST_SHARD_USAGE = `Usage: terreno-test-shard [options] [<index>/<total>] [path ...] [-- <bun test args>]

Splits test files under the given paths (default ".") into weight-balanced shards and runs
one shard with \`bun test\`. Everything after a literal \`--\` is forwarded to \`bun test\`.

Options:
  --shard <i>/<n>         1-based shard to run (default 1/1). May also be the first positional.
  --list                  Print the shard's files and process groups without running them.
  --pattern <glob>        Test file glob relative to the cwd (repeatable).
                          Default: ${DEFAULT_TEST_PATTERNS.join(", ")}
  --exclude <glob>        Drop files matching this cwd-relative glob (repeatable).
  --exclude-dir <name>    Skip directories with this name at any depth (repeatable).
                          Added to: ${DEFAULT_EXCLUDED_DIRS.join(", ")}
  --isolate <glob>        Run matching files in their own process (repeatable).
  --isolate-file <path>   File of isolate globs, one per line, # comments allowed.
  --process-per <mode>    shard (default) | dir | file: process granularity for other files.
  --dir-depth <n>         Leading path segments that define a directory for --process-per dir
                          (default 1).
  --lines-per-test <n>    Weight of one test in lines (default ${DEFAULT_LINES_PER_TEST}).
  --fail-fast             Stop after the first failing process.
  --cwd <dir>             Directory paths and globs are relative to (default: process cwd).
  -h, --help              Show this help.

Exit code: the bun test result (1 if any process failed), 0 for an empty shard, or 1 when no
test files match at all (a silently empty run would let CI pass without running anything).`;

const isProcessPer = (value: string): value is ProcessPer =>
  Object.values(PROCESS_PER).includes(value as ProcessPer);

const parsePositiveInt = ({value, flag}: {value: string; flag: string}): number | string => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return `${flag} must be a non-negative integer, got "${value}"`;
  }
  return parsed;
};

export interface TestShardCliOptions {
  shard: {index: number; total: number};
  paths: string[];
  patterns: string[];
  exclude: string[];
  excludeDirs: string[];
  isolate: string[];
  isolateFiles: string[];
  processPer: ProcessPer;
  dirDepth: number;
  linesPerTest: number;
  isListOnly: boolean;
  failFast: boolean;
  cwd: string;
  bunArgs: string[];
  isHelp: boolean;
}

interface ShardFlagValues {
  cwd?: string;
  "dir-depth"?: string;
  exclude?: string[];
  "exclude-dir"?: string[];
  "fail-fast"?: boolean;
  help?: boolean;
  isolate?: string[];
  "isolate-file"?: string[];
  "lines-per-test"?: string;
  list?: boolean;
  pattern?: string[];
  "process-per"?: string;
  shard?: string;
}

/** Throws on unknown flags or missing flag values (strict mode). */
const parseCliFlags = (args: string[]): {values: ShardFlagValues; positionals: string[]} =>
  parseArgs({
    allowPositionals: true,
    args,
    options: {
      cwd: {type: "string"},
      "dir-depth": {type: "string"},
      exclude: {multiple: true, type: "string"},
      "exclude-dir": {multiple: true, type: "string"},
      "fail-fast": {type: "boolean"},
      help: {short: "h", type: "boolean"},
      isolate: {multiple: true, type: "string"},
      "isolate-file": {multiple: true, type: "string"},
      "lines-per-test": {type: "string"},
      list: {type: "boolean"},
      pattern: {multiple: true, type: "string"},
      "process-per": {type: "string"},
      shard: {type: "string"},
    },
    strict: true,
  });

/** Parses CLI arguments; returns `{error}` with a message on invalid input. */
export const parseTestShardArgs = ({
  argv,
  cwd,
}: {
  argv: string[];
  cwd: string;
}): {options: TestShardCliOptions} | {error: string} => {
  const separatorIndex = argv.indexOf("--");
  const ownArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const bunArgs = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);

  let parsed: {values: ShardFlagValues; positionals: string[]};
  try {
    parsed = parseCliFlags(ownArgs);
  } catch (error) {
    return {error: (error as Error).message};
  }
  const {values, positionals} = parsed;

  let shardSpec = values.shard;
  const paths = [...positionals];
  if (!shardSpec && paths.length > 0 && /^\d+\/\d+$/.test(paths[0])) {
    shardSpec = paths.shift();
  }
  const shard = parseShardSpec({spec: shardSpec ?? "1/1"});
  if ("error" in shard) {
    return {error: shard.error};
  }

  const processPer = values["process-per"] ?? PROCESS_PER.shard;
  if (!isProcessPer(processPer)) {
    return {error: `--process-per must be one of shard, dir, file; got "${processPer}"`};
  }
  const dirDepth = parsePositiveInt({flag: "--dir-depth", value: values["dir-depth"] ?? "1"});
  if (typeof dirDepth === "string") {
    return {error: dirDepth};
  }
  const linesPerTest = parsePositiveInt({
    flag: "--lines-per-test",
    value: values["lines-per-test"] ?? String(DEFAULT_LINES_PER_TEST),
  });
  if (typeof linesPerTest === "string") {
    return {error: linesPerTest};
  }

  return {
    options: {
      bunArgs,
      cwd: path.resolve(cwd, values.cwd ?? "."),
      dirDepth: Math.max(dirDepth, 1),
      exclude: values.exclude ?? [],
      excludeDirs: [...DEFAULT_EXCLUDED_DIRS, ...(values["exclude-dir"] ?? [])],
      failFast: values["fail-fast"] ?? false,
      isHelp: values.help ?? false,
      isListOnly: values.list ?? false,
      isolate: values.isolate ?? [],
      isolateFiles: values["isolate-file"] ?? [],
      linesPerTest,
      paths: paths.length > 0 ? paths : ["."],
      patterns: values.pattern ?? [...DEFAULT_TEST_PATTERNS],
      processPer,
      shard,
    },
  };
};

/**
 * CLI entry point: discovers files, balances them into shards, prints the selected shard, and
 * (unless `--list`) runs it. Returns the process exit code instead of exiting so it is testable.
 */
export const runTestShardCli = ({
  argv,
  cwd = process.cwd(),
  spawn = spawnWithBun,
  logger = console,
}: {
  argv: string[];
  cwd?: string;
  spawn?: SpawnCommand;
  logger?: CliLogger;
}): {exitCode: number} => {
  const parsed = parseTestShardArgs({argv, cwd});
  if ("error" in parsed) {
    logger.error(`${parsed.error}\n\n${TEST_SHARD_USAGE}`);
    return {exitCode: 2};
  }
  const {options} = parsed;
  if (options.isHelp) {
    logger.info(TEST_SHARD_USAGE);
    return {exitCode: 0};
  }

  const {files, missingPaths} = collectFiles({
    cwd: options.cwd,
    exclude: options.exclude,
    excludeDirs: options.excludeDirs,
    paths: options.paths,
    patterns: options.patterns,
  });
  if (missingPaths.length > 0) {
    logger.error(`Path(s) do not exist: ${missingPaths.join(", ")}`);
    return {exitCode: 1};
  }
  if (files.length === 0) {
    logger.error(
      `No test files matching ${options.patterns.join(", ")} under: ${options.paths.join(", ")}`
    );
    return {exitCode: 1};
  }

  const isolate = [
    ...options.isolate,
    ...options.isolateFiles.flatMap(
      (file) => parseGlobList({text: readFileSync(path.resolve(options.cwd, file), "utf-8")}).globs
    ),
  ];
  const weighted = files.map((file) => ({
    file,
    weight: estimateTestWeight({
      linesPerTest: options.linesPerTest,
      source: readFileSync(path.join(options.cwd, file), "utf-8"),
    }).weight,
  }));
  const shards = buildShards({files: weighted, total: options.shard.total});
  const shard = shards[options.shard.index - 1];
  const groups = planProcessGroups({
    dirDepth: options.dirDepth,
    files: shard.files,
    isolate,
    processPer: options.processPer,
  });

  logger.info(
    `Shard ${options.shard.index}/${options.shard.total}: ${shard.files.length} of ${files.length} files, ` +
      `weight ${shard.weight} (all shards: ${shards.map((s) => s.weight).join(", ")}), ` +
      `${groups.length} process(es)`
  );
  for (const group of groups) {
    if (groups.length > 1) {
      logger.info(`  [${group.name}]`);
    }
    for (const file of group.files) {
      logger.info(`    ${file}`);
    }
  }

  if (options.isListOnly) {
    return {exitCode: 0};
  }
  if (groups.length === 0) {
    logger.info("Nothing to run for this shard.");
    return {exitCode: 0};
  }

  const outcome = runProcessGroups({
    bunArgs: options.bunArgs,
    cwd: options.cwd,
    failFast: options.failFast,
    groups,
    logger,
    spawn,
  });
  if (groups.length > 1) {
    logger.info(`\n${formatRunSummary(outcome).text}`);
  }
  return {exitCode: outcome.allPassed ? 0 : 1};
};
