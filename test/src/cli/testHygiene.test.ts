import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

import {
  applySuppressions,
  buildBaseline,
  checkTestSource,
  countByRule,
  diffAgainstBaseline,
  parseBaseline,
  parseTestHygieneArgs,
  resolveHygieneConfig,
  runTestHygieneCli,
} from "./testHygiene";
import type {HygieneViolation} from "./testHygieneRules";

const violation = (
  file: string,
  line: number,
  ruleId: HygieneViolation["ruleId"] = "no-sleep"
): HygieneViolation => ({file, line, message: "m", ruleId});

const captureLogger = (): {
  info: (m: string) => void;
  error: (m: string) => void;
  text: () => string;
} => {
  const lines: string[] = [];
  return {error: (m) => lines.push(m), info: (m) => lines.push(m), text: () => lines.join("\n")};
};

describe("applySuppressions", () => {
  it("drops violations whose previous line names the rule, including lists", () => {
    const sourceText = [
      "// test-hygiene-disable-next-line no-sleep -- polling not possible here",
      "a",
      "// test-hygiene-disable-next-line no-cache-busted-import, no-sleep",
      "b",
      "// test-hygiene-disable-next-line no-component-snapshot",
      "c",
    ].join("\n");
    const {violations} = applySuppressions({
      sourceText,
      violations: [violation("f", 1), violation("f", 2), violation("f", 4), violation("f", 6)],
    });
    expect(violations.map((v) => v.line)).toEqual([1, 6]);
  });
});

describe("checkTestSource", () => {
  it("runs rules and applies suppressions", () => {
    const {violations} = checkTestSource({
      config: {rootDir: "/r"},
      fileName: "/r/a.test.ts",
      sourceText: [
        "// test-hygiene-disable-next-line no-sleep",
        "await Bun.sleep(1);",
        "await Bun.sleep(2);",
      ].join("\n"),
    });
    expect(violations.map((v) => v.line)).toEqual([3]);
  });
});

describe("baseline", () => {
  const violations = [
    violation("b.test.ts", 9),
    violation("a.test.ts", 5),
    violation("a.test.ts", 1),
    violation("a.test.ts", 3, "no-component-snapshot"),
  ];

  it("builds sorted per file/rule counts", () => {
    expect(buildBaseline({violations}).entries).toEqual([
      {count: 1, file: "a.test.ts", rule: "no-component-snapshot"},
      {count: 2, file: "a.test.ts", rule: "no-sleep"},
      {count: 1, file: "b.test.ts", rule: "no-sleep"},
    ]);
  });

  it("reports violations beyond the baseline count and stale entries", () => {
    const {newViolations, staleEntries} = diffAgainstBaseline({
      baseline: [
        {count: 1, file: "a.test.ts", rule: "no-sleep"},
        {count: 3, file: "b.test.ts", rule: "no-sleep"},
      ],
      violations,
    });
    expect(newViolations.map((v) => [v.file, v.line, v.ruleId])).toEqual([
      ["a.test.ts", 3, "no-component-snapshot"],
      ["a.test.ts", 5, "no-sleep"],
    ]);
    expect(staleEntries).toEqual([{count: 3, file: "b.test.ts", rule: "no-sleep"}]);
  });

  it("parses valid baselines and rejects invalid ones", () => {
    expect(parseBaseline({text: '[{"file":"a","rule":"no-sleep","count":2}]'})).toEqual({
      entries: [{count: 2, file: "a", rule: "no-sleep"}],
    });
    expect(parseBaseline({text: "{"})).toHaveProperty("error");
    expect(parseBaseline({text: "{}"})).toHaveProperty("error");
    expect(parseBaseline({text: '[{"file":"a","rule":"nope","count":1}]'})).toHaveProperty("error");
  });

  it("counts by rule including zeroes", () => {
    expect(countByRule({rules: ["no-sleep", "no-component-snapshot"], violations}).counts).toEqual({
      "no-component-snapshot": 1,
      "no-sleep": 3,
    });
  });
});

describe("resolveHygieneConfig", () => {
  it("resolves paths against the config dir and honors rule toggles", () => {
    const {config} = resolveHygieneConfig({
      configDir: "/repo/app",
      file: {baseline: "scripts/base.json", root: "src", rules: {"no-sleep": false}},
    });
    expect(config.rootDir).toBe("/repo/app/src");
    expect(config.baselinePath).toBe("/repo/app/scripts/base.json");
    expect(config.rules).not.toContain("no-sleep");
    expect(config.ruleConfig.sleepCallees).toEqual(["Bun.sleep"]);
  });

  it("defaults the baseline into the root", () => {
    expect(resolveHygieneConfig({configDir: "/x"}).config.baselinePath).toBe(
      "/x/test-hygiene-baseline.json"
    );
  });
});

describe("parseTestHygieneArgs", () => {
  it("merges a config file with flags", () => {
    const parsed = parseTestHygieneArgs({
      argv: [
        "--config",
        "cfg/h.json",
        "--barrel-alias",
        "@b",
        "--rule",
        "no-sleep",
        "--rule",
        "no-direct-barrel-mock",
        "--disable-rule",
        "no-sleep",
        "--sleep-callee",
        "timeout",
      ],
      cwd: "/repo",
      readFile: () => JSON.stringify({barrels: {aliases: ["@a"]}, root: "app"}),
    });
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    const {config} = parsed.options;
    expect(config.rootDir).toBe("/repo/cfg/app");
    expect(config.ruleConfig.barrelAliases).toEqual(["@a", "@b"]);
    expect(config.ruleConfig.sleepCallees).toEqual(["Bun.sleep", "timeout"]);
    expect(config.rules).toEqual(["no-direct-barrel-mock"]);
  });

  it("resolves CLI root, baseline, and paths against the cwd", () => {
    const parsed = parseTestHygieneArgs({
      argv: [
        "--root",
        "app",
        "--baseline",
        "b.json",
        "app/src",
        "--format",
        "json",
        "--no-baseline",
      ],
      cwd: "/repo",
      readFile: () => undefined,
    });
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    expect(parsed.options.config.rootDir).toBe("/repo/app");
    expect(parsed.options.config.baselinePath).toBe("/repo/b.json");
    expect(parsed.options.config.paths).toEqual(["src"]);
    expect(parsed.options.format).toBe("json");
    expect(parsed.options.useBaseline).toBe(false);
  });

  it("returns errors for bad input", () => {
    const noFile = (): undefined => undefined;
    expect(parseTestHygieneArgs({argv: ["--x"], cwd: "/", readFile: noFile})).toHaveProperty(
      "error"
    );
    expect(
      parseTestHygieneArgs({argv: ["--rule", "nope"], cwd: "/", readFile: noFile})
    ).toHaveProperty("error");
    expect(
      parseTestHygieneArgs({argv: ["--format", "xml"], cwd: "/", readFile: noFile})
    ).toHaveProperty("error");
    expect(
      parseTestHygieneArgs({argv: ["--config", "a.json"], cwd: "/", readFile: noFile})
    ).toHaveProperty("error");
    expect(parseTestHygieneArgs({argv: [], cwd: "/", readFile: () => "{"})).toHaveProperty("error");
  });
});

describe("runTestHygieneCli", () => {
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "terreno-hygiene-"));
    mkdirSync(path.join(root, "hooks"), {recursive: true});
    writeFileSync(
      path.join(root, "hooks/a.test.ts"),
      ['mock.module("@hooks", () => ({}));', "await Bun.sleep(1);", ""].join("\n")
    );
    writeFileSync(path.join(root, "hooks/clean.test.ts"), 'it("ok", () => {});\n');
    writeFileSync(
      path.join(root, "test-hygiene.config.json"),
      JSON.stringify({barrels: {aliases: ["@hooks"]}})
    );
  });

  afterAll(() => {
    rmSync(root, {force: true, recursive: true});
  });

  it("fails on new violations and prints per-rule counts", () => {
    const logger = captureLogger();
    expect(runTestHygieneCli({argv: [], cwd: root, logger}).exitCode).toBe(1);
    expect(logger.text()).toContain("hooks/a.test.ts:1 no-direct-barrel-mock");
    expect(logger.text()).toContain("Checked 2 file(s)");
    expect(logger.text()).toContain("no-sleep: 1");
  });

  it("passes after --update-baseline and reports stale entries once fixed", () => {
    expect(
      runTestHygieneCli({argv: ["--update-baseline"], cwd: root, logger: captureLogger()}).exitCode
    ).toBe(0);
    const baselinePath = path.join(root, "test-hygiene-baseline.json");
    expect(JSON.parse(readFileSync(baselinePath, "utf-8"))).toHaveLength(3);
    expect(runTestHygieneCli({argv: [], cwd: root, logger: captureLogger()}).exitCode).toBe(0);
    expect(
      runTestHygieneCli({argv: ["--no-baseline"], cwd: root, logger: captureLogger()}).exitCode
    ).toBe(1);

    writeFileSync(path.join(root, "hooks/a.test.ts"), "await Bun.sleep(1);\n");
    const logger = captureLogger();
    expect(runTestHygieneCli({argv: [], cwd: root, logger}).exitCode).toBe(0);
    expect(logger.text()).toContain("--update-baseline to ratchet");
    rmSync(baselinePath);
  });

  it("emits JSON output", () => {
    const logger = captureLogger();
    runTestHygieneCli({
      argv: ["--format", "json", "--disable-rule", "no-sleep"],
      cwd: root,
      logger,
    });
    const report = JSON.parse(logger.text());
    expect(report.filesChecked).toBe(2);
    expect(report.countsByRule).not.toHaveProperty("no-sleep");
  });

  it("handles help, usage errors, missing paths, and invalid baselines", () => {
    const help = captureLogger();
    expect(runTestHygieneCli({argv: ["-h"], cwd: root, logger: help}).exitCode).toBe(0);
    expect(help.text()).toContain("Usage: terreno-test-hygiene");
    expect(runTestHygieneCli({argv: ["--bad"], cwd: root, logger: captureLogger()}).exitCode).toBe(
      2
    );
    expect(
      runTestHygieneCli({argv: ["missing"], cwd: root, logger: captureLogger()}).exitCode
    ).toBe(2);
    const badBaseline = path.join(root, "bad.json");
    writeFileSync(badBaseline, "{}");
    expect(
      runTestHygieneCli({argv: ["--baseline", "bad.json"], cwd: root, logger: captureLogger()})
        .exitCode
    ).toBe(2);
  });
});
