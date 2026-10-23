import {describe, expect, it} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {formatSummary, listSmokeWorkspaces, runSmokes} from "./runAll";

const makeRepo = (): string => {
  const rootDir = mkdtempSync(join(tmpdir(), "smoke-runall-"));
  writeFileSync(
    join(rootDir, "package.json"),
    JSON.stringify({workspaces: ["api", "ui", "website", "missing"]})
  );
  const packages: Record<string, object> = {
    api: {name: "@terreno/api", scripts: {smoke: "bun e2e/smoke.ts"}},
    ui: {name: "@terreno/ui", scripts: {smoke: "playwright test e2e/smoke.spec.ts"}},
    website: {name: "website", scripts: {build: "docusaurus build"}},
  };
  for (const [dir, pkg] of Object.entries(packages)) {
    mkdirSync(join(rootDir, dir));
    writeFileSync(join(rootDir, dir, "package.json"), JSON.stringify(pkg));
  }
  return rootDir;
};

describe("listSmokeWorkspaces", () => {
  it("lists only workspaces with a smoke script, in workspace order", () => {
    expect(listSmokeWorkspaces({rootDir: makeRepo()})).toEqual([
      {dir: "api", name: "@terreno/api"},
      {dir: "ui", name: "@terreno/ui"},
    ]);
  });

  it("narrows to the requested workspaces", () => {
    expect(listSmokeWorkspaces({only: ["ui"], rootDir: makeRepo()})).toEqual([
      {dir: "ui", name: "@terreno/ui"},
    ]);
  });

  it("rejects a requested workspace that has no smoke script", () => {
    expect(() => listSmokeWorkspaces({only: ["website"], rootDir: makeRepo()})).toThrow(
      "No smoke script in: website"
    );
  });

  it("rejects a workspace name that does not exist", () => {
    expect(() => listSmokeWorkspaces({only: ["apii"], rootDir: makeRepo()})).toThrow(
      "Unknown workspace(s): apii"
    );
  });
});

describe("formatSummary", () => {
  it("prints each package's time and the pass/fail count", () => {
    expect(
      formatSummary([
        {dir: "api", durationMs: 12345, name: "@terreno/api", passed: true},
        {dir: "rtk", durationMs: 800, name: "@terreno/rtk", passed: false},
      ])
    ).toBe("✅ @terreno/api  12.3 s\n❌ @terreno/rtk  0.8 s\n1 passed, 1 failed");
  });

  it("handles an empty run", () => {
    expect(formatSummary([])).toBe("0 passed, 0 failed");
  });
});

describe("runSmokes", () => {
  it("runs every smoke in order, keeps going after a failure, and records each result", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "smoke-runall-run-"));
    const log = join(rootDir, "order.log");
    const smokes: Record<string, string> = {
      first: `echo first >> ${log}; exit 1`,
      second: `echo second >> ${log}`,
    };
    for (const [dir, smoke] of Object.entries(smokes)) {
      mkdirSync(join(rootDir, dir));
      writeFileSync(
        join(rootDir, dir, "package.json"),
        JSON.stringify({name: dir, scripts: {smoke}})
      );
    }

    const results = runSmokes({
      rootDir,
      workspaces: [
        {dir: "first", name: "first"},
        {dir: "second", name: "second"},
      ],
    });

    expect(results.map(({name, passed}) => ({name, passed}))).toEqual([
      {name: "first", passed: false},
      {name: "second", passed: true},
    ]);
    expect(results.every((result) => result.durationMs >= 0)).toBe(true);
    expect(existsSync(log) && readFileSync(log, "utf8")).toBe("first\nsecond\n");
  });
});
