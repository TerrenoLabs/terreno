import {describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  buildShardArgs,
  findIsolatedFiles,
  formatShardSummary,
  MAX_AUTO_SHARDS,
  parseRunnerArgs,
  type RunShardProcess,
  resolveShardCount,
  runIsolatedFiles,
  runPool,
  runShards,
} from "./lib";

describe("resolveShardCount", () => {
  it("uses half the cores, at least one and at most the automatic cap", () => {
    expect(resolveShardCount({cpuCount: 1, env: {}})).toEqual({total: 1});
    expect(resolveShardCount({cpuCount: 2, env: {}})).toEqual({total: 1});
    expect(resolveShardCount({cpuCount: 4, env: {}})).toEqual({total: 2});
    expect(resolveShardCount({cpuCount: 64, env: {}})).toEqual({total: MAX_AUTO_SHARDS});
  });

  it("lets TERRENO_TEST_SHARDS override the core count, above the cap too", () => {
    expect(resolveShardCount({cpuCount: 64, env: {TERRENO_TEST_SHARDS: "1"}})).toEqual({total: 1});
    expect(resolveShardCount({cpuCount: 2, env: {TERRENO_TEST_SHARDS: " 6 "}})).toEqual({
      total: 6,
    });
  });

  it("ignores an empty override", () => {
    expect(resolveShardCount({cpuCount: 8, env: {TERRENO_TEST_SHARDS: " "}})).toEqual({total: 4});
  });

  it("rejects an override that is not a positive integer", () => {
    for (const value of ["0", "-2", "1.5", "many"]) {
      const result = resolveShardCount({cpuCount: 8, env: {TERRENO_TEST_SHARDS: value}});
      expect(result.error).toContain(`got "${value}"`);
    }
  });
});

describe("buildShardArgs", () => {
  it("adds the shard flag before the forwarded arguments", () => {
    expect(buildShardArgs({bunArgs: ["--timeout=1000", "src/"], index: 2, total: 3})).toEqual({
      args: ["test", "--shard=2/3", "--timeout=1000", "src/"],
    });
  });

  it("runs a single shard as a plain bun test", () => {
    expect(buildShardArgs({bunArgs: ["src/"], index: 1, total: 1})).toEqual({
      args: ["test", "src/"],
    });
  });
});

describe("parseRunnerArgs", () => {
  it("forwards everything after the separator", () => {
    expect(parseRunnerArgs({argv: ["--", "--only-failures", "src/"]})).toEqual({
      bunArgs: ["--only-failures", "src/"],
      isIsolatedIncluded: false,
    });
  });

  it("forwards every argument when there is no separator", () => {
    expect(parseRunnerArgs({argv: ["--timeout=5"]})).toEqual({
      bunArgs: ["--timeout=5"],
      isIsolatedIncluded: false,
    });
    expect(parseRunnerArgs({argv: []})).toEqual({bunArgs: [], isIsolatedIncluded: false});
  });

  it("reads --isolated before the separator and rejects other options there", () => {
    expect(parseRunnerArgs({argv: ["--isolated", "--", "--preload", "./setup.ts"]})).toEqual({
      bunArgs: ["--preload", "./setup.ts"],
      isIsolatedIncluded: true,
    });
    expect(parseRunnerArgs({argv: ["--isolate", "--", "src/"]}).error).toContain("--isolate");
  });

  it("rejects --isolated without a separator instead of handing it to bun", () => {
    expect(parseRunnerArgs({argv: ["--isolated", "--timeout=5"]}).error).toContain('before "--"');
  });
});

describe("runShards", () => {
  it("starts every shard before any finishes and reports them in shard order", async () => {
    const started: string[][] = [];
    const release: (() => void)[] = [];
    const run: RunShardProcess = ({args}) => {
      started.push(args);
      return new Promise((resolvePromise) => {
        release.push(() => {
          resolvePromise({exitCode: args[1] === "--shard=2/3" ? 1 : 0, output: `out ${args[1]}\n`});
        });
      });
    };
    const written: string[] = [];
    const pending = runShards({
      argsForShard: (index) => [`--coverage-dir=cov-${index}`],
      cwd: "/pkg",
      env: {},
      run,
      total: 3,
      write: (text) => {
        written.push(text);
      },
    });
    await Promise.resolve();
    expect(started).toEqual([
      ["test", "--shard=1/3", "--coverage-dir=cov-1"],
      ["test", "--shard=2/3", "--coverage-dir=cov-2"],
      ["test", "--shard=3/3", "--coverage-dir=cov-3"],
    ]);

    // Finish out of order: output blocks follow completion, results follow shard order.
    release[2]();
    release[0]();
    release[1]();
    const {results} = await pending;
    expect(results.map((result) => [result.index, result.exitCode])).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
    ]);
    expect(written).toEqual([
      "\n=== shard 3/3 (exit 0) ===\nout --shard=3/3\n",
      "\n=== shard 1/3 (exit 0) ===\nout --shard=1/3\n",
      "\n=== shard 2/3 (exit 1) ===\nout --shard=2/3\n",
    ]);
  });

  it("reports the shards still running while their output is held", async () => {
    const release: (() => void)[] = [];
    const run: RunShardProcess = () =>
      new Promise((resolvePromise) => {
        release.push(() => {
          resolvePromise({exitCode: 0, output: ""});
        });
      });
    const written: string[] = [];
    const pending = runShards({
      argsForShard: () => [],
      cwd: "/pkg",
      env: {},
      heartbeatMs: 5,
      run,
      total: 2,
      write: (text) => {
        written.push(text);
      },
    });
    await Promise.resolve();
    release[0]();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
    release[1]();
    await pending;
    expect(written.some((text) => /^\[shards\] still running: 2 of 2 \(\d+s\)\n$/.test(text))).toBe(
      true
    );
    const count = written.length;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    expect(written.length).toBe(count);
  });

  it("streams a single shard instead of buffering it", async () => {
    const written: string[] = [];
    const run: RunShardProcess = async ({args, onOutput}) => {
      onOutput?.("live\n");
      return {exitCode: 0, output: `${args.join(" ")}\n`};
    };
    const {results} = await runShards({
      argsForShard: () => ["src/"],
      cwd: "/pkg",
      env: {},
      run,
      total: 1,
      write: (text) => {
        written.push(text);
      },
    });
    expect(written).toEqual(["live\n"]);
    expect(results[0].output).toBe("test src/\n");
  });

  it("runs real bun test shards that together cover every file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "terreno-test-shards-"));
    try {
      for (const name of ["a", "b", "c"]) {
        writeFileSync(
          join(dir, `${name}.test.ts`),
          `import {expect, test} from "bun:test";\ntest("${name}", () => { expect(1).toBe(1); });\n`
        );
      }
      const {results} = await runShards({
        argsForShard: () => [],
        cwd: dir,
        env: {...process.env, FORCE_COLOR: "0"},
        total: 2,
        write: () => {},
      });
      expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
      const passed = results
        .map((result) => Number(result.output.match(/(\d+) pass/)?.[1] ?? 0))
        .reduce((sum, count) => sum + count, 0);
      expect(passed).toBe(3);
    } finally {
      rmSync(dir, {force: true, recursive: true});
    }
  });
});

describe("formatShardSummary", () => {
  it("lists each shard with its status and duration", () => {
    const {text} = formatShardSummary({
      results: [
        {durationMs: 1234, exitCode: 0, index: 1, output: ""},
        {durationMs: 61_000, exitCode: 1, index: 2, output: ""},
      ],
    });
    expect(text).toBe("=== Shards ===\nPASS  shard 1/2  (1.2s)\nFAIL  shard 2/2  (61.0s)");
  });
});

describe("runPool", () => {
  it("keeps results in input order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = [30, 5, 20, 1, 10].map((delayMs, index) => async (): Promise<number> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      inFlight -= 1;
      return index;
    });
    expect(await runPool(tasks, 2)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it("returns an empty list for no tasks", async () => {
    expect(await runPool([], 4)).toEqual([]);
  });
});

describe("isolated files", () => {
  it("finds isolated files in src and src/isolated, sorted", () => {
    const dir = mkdtempSync(join(tmpdir(), "terreno-test-isolated-"));
    try {
      mkdirSync(join(dir, "src", "isolated"), {recursive: true});
      writeFileSync(join(dir, "src", "b.isolated.ts"), "");
      writeFileSync(join(dir, "src", "plain.test.ts"), "");
      writeFileSync(join(dir, "src", "isolated", "a.isolated.tsx"), "");
      expect(findIsolatedFiles(dir)).toEqual([
        "././src/b.isolated.ts",
        "././src/isolated/a.isolated.tsx",
      ]);
      expect(findIsolatedFiles(join(dir, "missing"))).toEqual([]);
    } finally {
      rmSync(dir, {force: true, recursive: true});
    }
  });

  it("runs each file in its own process with the forwarded flags and its own env", async () => {
    const calls: {args: string[]; realApi: string | undefined}[] = [];
    const run: RunShardProcess = async ({args, env}) => {
      calls.push({args, realApi: env.ADMIN_USE_REAL_API});
      return {exitCode: args.at(-1)?.includes("broken") ? 1 : 0, output: "ran\n"};
    };
    const written: string[] = [];
    const {results} = await runIsolatedFiles({
      bunArgs: ["--max-concurrency=1"],
      cwd: "/pkg",
      env: {},
      files: ["././src/isolated/hooks.isolated.tsx", "././src/isolated/broken.isolated.ts"],
      limit: 1,
      run,
      write: (text) => {
        written.push(text);
      },
    });
    expect(calls).toEqual([
      {args: ["test", "--max-concurrency=1", "././src/isolated/hooks.isolated.tsx"], realApi: "1"},
      {
        args: ["test", "--max-concurrency=1", "././src/isolated/broken.isolated.ts"],
        realApi: undefined,
      },
    ]);
    expect(results.map((result) => result.exitCode)).toEqual([0, 1]);
    expect(written[1]).toBe("\n=== ././src/isolated/broken.isolated.ts (exit 1) ===\nran\n");
  });
});
