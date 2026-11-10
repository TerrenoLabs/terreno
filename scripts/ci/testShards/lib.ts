/**
 * Runs one package's `bun test` as several `--shard=<i>/<n>` processes at the same time.
 *
 * Why: a Bun test process runs its files one after another, and a backend suite spends most
 * of that time waiting on its own Mongo. Splitting the files across processes uses the idle
 * cores without changing what a test file sees: each shard is an ordinary `bun test` process
 * with its own preload, module registry, and in-memory Mongo.
 *
 * Docs: docs/explanation/test-sharding.md
 */
import {spawn} from "node:child_process";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

/** Most shards picked automatically; more than this mostly adds Mongo and module-load cost. */
export const MAX_AUTO_SHARDS = 4;

const SHARD_COUNT_ENV = "TERRENO_TEST_SHARDS";

export interface ShardResult {
  durationMs: number;
  exitCode: number;
  /** 1-based shard number. */
  index: number;
  output: string;
}

interface ShardProcess {
  exitCode: number;
  output: string;
}

/** Runs one command to completion and returns its combined output. Injectable for tests. */
export type RunShardProcess = (options: {
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /** Called with each chunk as it arrives, for callers that stream output. */
  onOutput?: (text: string) => void;
}) => Promise<ShardProcess>;

/**
 * Picks how many shards to run. `TERRENO_TEST_SHARDS` wins when it is a positive integer.
 * Otherwise use half the cores, because a backend shard keeps a Bun process and a mongod busy.
 * CI sets the variable: a container reports the host's cores, not its own CPU limit.
 */
export const resolveShardCount = ({
  cpuCount,
  env,
}: {
  cpuCount: number;
  env: Record<string, string | undefined>;
}): {error?: string; total: number} => {
  const raw = env[SHARD_COUNT_ENV]?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return {error: `${SHARD_COUNT_ENV} must be a positive integer, got "${raw}"`, total: 1};
    }
    return {total: parsed};
  }
  return {total: Math.min(MAX_AUTO_SHARDS, Math.max(1, Math.floor(cpuCount / 2)))};
};

/** `bun test` arguments for one shard. A single shard runs the suite unsplit. */
export const buildShardArgs = ({
  bunArgs,
  index,
  total,
}: {
  bunArgs: readonly string[];
  index: number;
  total: number;
}): {args: string[]} => ({
  args: total === 1 ? ["test", ...bunArgs] : ["test", `--shard=${index}/${total}`, ...bunArgs],
});

/**
 * Splits the CLI arguments at the first `--`; everything after it goes to `bun test`. Before
 * it, `--isolated` also runs the package's isolated files after the shards.
 */
export const parseRunnerArgs = ({
  argv,
}: {
  argv: readonly string[];
}): {bunArgs: string[]; error?: string; isIsolatedIncluded: boolean} => {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? [] : argv.slice(0, separator);
  const bunArgs = separator === -1 ? [...argv] : argv.slice(separator + 1);
  if (separator === -1 && bunArgs.includes("--isolated")) {
    // Bun accepts the flag silently, so the isolated files would be skipped without an error.
    return {
      bunArgs,
      error: 'Put "--isolated" before "--": test-shards.ts --isolated -- <bun test args>',
      isIsolatedIncluded: false,
    };
  }
  const unknown = own.filter((arg) => arg !== "--isolated");
  if (unknown.length > 0) {
    return {
      bunArgs,
      error: `Unknown option(s) before "--": ${unknown.join(" ")}`,
      isIsolatedIncluded: false,
    };
  }
  return {bunArgs, isIsolatedIncluded: own.includes("--isolated")};
};

const spawnBun: RunShardProcess = ({args, cwd, env, onOutput}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bun", args, {cwd, env, stdio: ["ignore", "pipe", "pipe"]});
    let output = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString();
      output += text;
      onOutput?.(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({exitCode: code ?? 1, output});
    });
  });

/**
 * Starts every shard at once and waits for all of them. A shard's output is written in one
 * block when it finishes so the logs of different shards never interleave; a single shard
 * streams as it runs.
 */
export const runShards = async ({
  argsForShard,
  cwd,
  env,
  heartbeatMs = 60_000,
  run = spawnBun,
  total,
  write = (text) => {
    process.stdout.write(text);
  },
}: {
  /** Extra `bun test` arguments for one shard, e.g. its own coverage directory. */
  argsForShard: (index: number) => readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
  heartbeatMs?: number;
  run?: RunShardProcess;
  total: number;
  write?: (text: string) => void;
}): Promise<{results: ShardResult[]}> => {
  const indexes = Array.from({length: total}, (_, offset) => offset + 1);
  // Shard output is held until the shard ends. CI kills a job that prints nothing for ten
  // minutes, so say which shards are still running once a minute.
  const running = new Set(indexes);
  const startedAt = performance.now();
  const heartbeat =
    total > 1
      ? setInterval(() => {
          const seconds = Math.round((performance.now() - startedAt) / 1000);
          write(`[shards] still running: ${[...running].join(", ")} of ${total} (${seconds}s)\n`);
        }, heartbeatMs)
      : undefined;
  const results = await Promise.all(
    indexes.map(async (index): Promise<ShardResult> => {
      const start = performance.now();
      const {args} = buildShardArgs({bunArgs: argsForShard(index), index, total});
      const {exitCode, output} = await run({
        args,
        cwd,
        env,
        onOutput: total === 1 ? write : undefined,
      });
      const durationMs = performance.now() - start;
      running.delete(index);
      if (total > 1) {
        write(`\n=== shard ${index}/${total} (exit ${exitCode}) ===\n${output}`);
      }
      return {durationMs, exitCode, index, output};
    })
  ).finally(() => {
    clearInterval(heartbeat);
  });
  return {results};
};

/** One line per shard, printed after a multi-shard run. */
export const formatShardSummary = ({
  results,
}: {
  results: readonly ShardResult[];
}): {text: string} => {
  const lines = ["=== Shards ==="];
  for (const result of results) {
    const status = result.exitCode === 0 ? "PASS" : "FAIL";
    lines.push(
      `${status}  shard ${result.index}/${results.length}  (${(result.durationMs / 1000).toFixed(1)}s)`
    );
  }
  return {text: lines.join("\n")};
};

const isIsolatedTestFile = (name: string): boolean =>
  name.endsWith(".isolated.ts") || name.endsWith(".isolated.tsx");

/**
 * Lists a package's isolated test files (`src/*.isolated.ts(x)` and `src/isolated/`), sorted.
 * Each one needs a `bun test` process of its own; see docs/explanation/test-isolation.md.
 */
export const findIsolatedFiles = (cwd: string): string[] => {
  const files: string[] = [];
  for (const [dir, prefix] of [
    [join(cwd, "src"), "././src/"],
    [join(cwd, "src", "isolated"), "././src/isolated/"],
  ]) {
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (isIsolatedTestFile(name)) {
        files.push(`${prefix}${name}`);
      }
    }
  }
  return files.sort();
};

/** `@test-env KEY=VALUE` in an isolated file's leading comment sets a variable for its process. */
const TEST_ENV_PRAGMA = /@test-env\s+([A-Z_][A-Z0-9_]*)=([\w.:/-]+)/g;

/** Bytes of an isolated file searched for `@test-env` pragmas: its leading comment. */
const TEST_ENV_PRAGMA_WINDOW = 2048;

/**
 * Extra environment one isolated file asks for with `@test-env KEY=VALUE` pragmas in its
 * leading comment. The file states its own needs, so the runner knows no package's files.
 */
export const isolatedFileEnv = ({
  cwd,
  file,
}: {
  cwd: string;
  file: string;
}): {env: Record<string, string>} => {
  const path = join(cwd, file);
  if (!existsSync(path)) {
    return {env: {}};
  }
  const head = readFileSync(path, "utf8").slice(0, TEST_ENV_PRAGMA_WINDOW);
  const env: Record<string, string> = {};
  for (const [, key, value] of head.matchAll(TEST_ENV_PRAGMA)) {
    env[key] = value;
  }
  return {env};
};

/** Runs `tasks` with at most `limit` in flight, keeping results in input order. */
export const runPool = async <T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number
): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({length: Math.max(1, Math.min(limit, tasks.length))}, worker));
  return results;
};

/**
 * Runs each isolated file in its own `bun test` process, at most `limit` at a time, and writes
 * each file's output as one block when it finishes.
 */
export const runIsolatedFiles = async ({
  bunArgs,
  cwd,
  env,
  files,
  limit,
  run = spawnBun,
  write = (text) => {
    process.stdout.write(text);
  },
}: {
  bunArgs: readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
  files: readonly string[];
  limit: number;
  run?: RunShardProcess;
  write?: (text: string) => void;
}): Promise<{results: {exitCode: number; file: string}[]}> => {
  const results = await runPool(
    files.map((file) => async () => {
      const {exitCode, output} = await run({
        args: ["test", ...bunArgs, file],
        cwd,
        env: {...env, ...isolatedFileEnv({cwd, file}).env},
      });
      write(`\n=== ${file} (exit ${exitCode}) ===\n${output}`);
      return {exitCode, file};
    }),
    limit
  );
  return {results};
};
