import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

import {
  buildBunTestCommand,
  buildShards,
  countTests,
  estimateTestWeight,
  formatRunSummary,
  parseGlobList,
  parseShardSpec,
  parseTestShardArgs,
  planProcessGroups,
  runProcessGroups,
  runTestShardCli,
  type SpawnCommand,
} from "./testShard";

const silentLogger = (): {
  info: (m: string) => void;
  error: (m: string) => void;
  lines: string[];
} => {
  const lines: string[] = [];
  return {error: (m) => lines.push(m), info: (m) => lines.push(m), lines};
};

describe("countTests / estimateTestWeight", () => {
  it("counts it/test calls including modifiers but not describe", () => {
    const source = [
      'describe("x", () => {',
      '  it("a", () => {});',
      '  test.only("b", () => {});',
      '  it.each([1])("c", () => {});',
      "  // it is not a call",
      "});",
    ].join("\n");
    expect(countTests({source}).testCount).toBe(3);
    expect(estimateTestWeight({source}).weight).toBe(6 + 50 * 3);
    expect(estimateTestWeight({linesPerTest: 0, source}).weight).toBe(6);
  });
});

describe("buildShards", () => {
  it("assigns heaviest first to the lightest shard, deterministically", () => {
    const shards = buildShards({
      files: [
        {file: "a", weight: 10},
        {file: "b", weight: 8},
        {file: "c", weight: 5},
        {file: "d", weight: 4},
        {file: "e", weight: 3},
      ],
      total: 2,
    });
    expect(shards).toEqual([
      {files: ["a", "d"], weight: 14},
      {files: ["b", "c", "e"], weight: 16},
    ]);
  });

  it("leaves extra shards empty when there are more shards than files", () => {
    const shards = buildShards({files: [{file: "a", weight: 1}], total: 3});
    expect(shards.map((s) => s.files.length)).toEqual([1, 0, 0]);
  });

  it("breaks weight ties by file name", () => {
    const shards = buildShards({
      files: [
        {file: "z", weight: 1},
        {file: "a", weight: 1},
      ],
      total: 2,
    });
    expect(shards[0].files).toEqual(["a"]);
    expect(shards[1].files).toEqual(["z"]);
  });
});

describe("parseShardSpec", () => {
  it("parses valid specs and rejects invalid ones", () => {
    expect(parseShardSpec({spec: "2/4"})).toEqual({index: 2, total: 4});
    expect(parseShardSpec({spec: "0/4"})).toHaveProperty("error");
    expect(parseShardSpec({spec: "5/4"})).toHaveProperty("error");
    expect(parseShardSpec({spec: "1/0"})).toHaveProperty("error");
    expect(parseShardSpec({spec: "two"})).toHaveProperty("error");
  });
});

describe("planProcessGroups", () => {
  const files = ["a/one.test.ts", "a/two.test.ts", "b/c/three.test.ts", "root.test.ts"];

  it("runs shared files in one process and isolated files alone", () => {
    expect(planProcessGroups({files, isolate: ["**/two.test.ts"]})).toEqual([
      {files: ["a/one.test.ts", "b/c/three.test.ts", "root.test.ts"], name: "shared"},
      {files: ["a/two.test.ts"], name: "a/two.test.ts (isolated)"},
    ]);
  });

  it("groups by directory prefix", () => {
    expect(planProcessGroups({files, processPer: "dir"}).map((g) => g.name)).toEqual([
      ".",
      "a",
      "b",
    ]);
    expect(planProcessGroups({dirDepth: 2, files, processPer: "dir"}).map((g) => g.name)).toEqual([
      ".",
      "a",
      "b/c",
    ]);
  });

  it("gives every file its own process", () => {
    expect(planProcessGroups({files, processPer: "file"})).toHaveLength(4);
  });

  it("returns no groups for an empty shard", () => {
    expect(planProcessGroups({files: []})).toEqual([]);
  });
});

describe("buildBunTestCommand", () => {
  it("anchors relative paths with ./ and keeps bun args before files", () => {
    expect(
      buildBunTestCommand({
        bunArgs: ["--timeout", "1000"],
        files: ["src/a.test.ts", "../b.test.ts"],
      }).cmd
    ).toEqual(["bun", "test", "--timeout", "1000", "./src/a.test.ts", "../b.test.ts"]);
  });
});

describe("runProcessGroups", () => {
  const groups = [
    {files: ["a.test.ts"], name: "a"},
    {files: ["b.test.ts"], name: "b"},
    {files: ["c.test.ts"], name: "c"},
  ];

  it("runs every group and reports failure without --fail-fast", () => {
    const calls: string[][] = [];
    const spawn: SpawnCommand = ({cmd}) => {
      calls.push(cmd);
      return {exitCode: cmd.includes("./b.test.ts") ? 1 : 0};
    };
    const outcome = runProcessGroups({cwd: "/x", groups, logger: silentLogger(), spawn});
    expect(calls).toHaveLength(3);
    expect(outcome.allPassed).toBe(false);
    expect(outcome.skipped).toEqual([]);
    const {text} = formatRunSummary(outcome);
    expect(text).toContain("FAIL  b");
    expect(text).toContain("PASS  c");
  });

  it("stops at the first failure with failFast and marks the rest skipped", () => {
    const outcome = runProcessGroups({
      cwd: "/x",
      failFast: true,
      groups,
      logger: silentLogger(),
      spawn: () => ({exitCode: 1}),
    });
    expect(outcome.results).toHaveLength(1);
    expect(outcome.skipped.map((g) => g.name)).toEqual(["b", "c"]);
    expect(formatRunSummary(outcome).text).toContain("SKIP  c");
  });
});

describe("parseGlobList", () => {
  it("drops comments and blank lines", () => {
    expect(parseGlobList({text: "# header\n\na.test.ts # why\n  b/**  \n"}).globs).toEqual([
      "a.test.ts",
      "b/**",
    ]);
  });
});

describe("parseTestShardArgs", () => {
  it("accepts a positional shard spec and forwards args after --", () => {
    const parsed = parseTestShardArgs({argv: ["2/3", "src", "--", "--timeout", "5"], cwd: "/r"});
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    expect(parsed.options.shard).toEqual({index: 2, total: 3});
    expect(parsed.options.paths).toEqual(["src"]);
    expect(parsed.options.bunArgs).toEqual(["--timeout", "5"]);
  });

  it("defaults to shard 1/1 over the cwd", () => {
    const parsed = parseTestShardArgs({argv: [], cwd: "/r"});
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    expect(parsed.options.shard).toEqual({index: 1, total: 1});
    expect(parsed.options.paths).toEqual(["."]);
    expect(parsed.options.cwd).toBe("/r");
  });

  it("rejects unknown flags and bad values", () => {
    expect(parseTestShardArgs({argv: ["--bogus"], cwd: "/r"})).toHaveProperty("error");
    expect(parseTestShardArgs({argv: ["--process-per", "nope"], cwd: "/r"})).toHaveProperty(
      "error"
    );
    expect(parseTestShardArgs({argv: ["--dir-depth", "x"], cwd: "/r"})).toHaveProperty("error");
    expect(parseTestShardArgs({argv: ["--lines-per-test", "-1"], cwd: "/r"})).toHaveProperty(
      "error"
    );
    expect(parseTestShardArgs({argv: ["--shard", "9/2"], cwd: "/r"})).toHaveProperty("error");
  });
});

describe("runTestShardCli", () => {
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "terreno-shard-"));
    mkdirSync(path.join(root, "src/a"), {recursive: true});
    writeFileSync(path.join(root, "src/a/big.test.ts"), 'it("1", () => {});\nit("2", () => {});\n');
    writeFileSync(path.join(root, "src/a/small.test.ts"), 'it("1", () => {});\n');
    writeFileSync(path.join(root, "src/leaky.test.ts"), 'it("1", () => {});\n');
    writeFileSync(path.join(root, "isolate.txt"), "# leaks mock.module\nsrc/leaky.test.ts\n");
  });

  afterAll(() => {
    rmSync(root, {force: true, recursive: true});
  });

  it("lists a shard without running it", () => {
    const logger = silentLogger();
    const calls: string[][] = [];
    const {exitCode} = runTestShardCli({
      argv: ["--list", "--shard", "1/2", "src"],
      cwd: root,
      logger,
      spawn: ({cmd}) => {
        calls.push(cmd);
        return {exitCode: 0};
      },
    });
    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(logger.lines[0]).toContain("Shard 1/2: 1 of 3 files");
    expect(logger.lines.join("\n")).toContain("src/a/big.test.ts");
  });

  it("runs isolated files in their own process and propagates failure", () => {
    const calls: string[][] = [];
    const {exitCode} = runTestShardCli({
      argv: ["--isolate-file", "isolate.txt", "src", "--", "--bail"],
      cwd: root,
      logger: silentLogger(),
      spawn: ({cmd, cwd}) => {
        expect(cwd).toBe(root);
        calls.push(cmd);
        return {exitCode: cmd.includes("./src/leaky.test.ts") ? 1 : 0};
      },
    });
    expect(exitCode).toBe(1);
    expect(calls).toEqual([
      ["bun", "test", "--bail", "./src/a/big.test.ts", "./src/a/small.test.ts"],
      ["bun", "test", "--bail", "./src/leaky.test.ts"],
    ]);
  });

  it("exits 0 for an empty shard and 1 when nothing matches", () => {
    const empty = runTestShardCli({argv: ["4/4", "src"], cwd: root, logger: silentLogger()});
    expect(empty.exitCode).toBe(0);
    const none = runTestShardCli({
      argv: ["--pattern", "**/*.spec.ts", "src"],
      cwd: root,
      logger: silentLogger(),
    });
    expect(none.exitCode).toBe(1);
    const missing = runTestShardCli({argv: ["nope"], cwd: root, logger: silentLogger()});
    expect(missing.exitCode).toBe(1);
  });

  it("prints help and returns 2 on usage errors", () => {
    const help = silentLogger();
    expect(runTestShardCli({argv: ["--help"], cwd: root, logger: help}).exitCode).toBe(0);
    expect(help.lines[0]).toContain("Usage: terreno-test-shard");
    expect(runTestShardCli({argv: ["--nope"], cwd: root, logger: silentLogger()}).exitCode).toBe(2);
  });
});
