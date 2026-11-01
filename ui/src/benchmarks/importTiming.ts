import {spawnSync} from "node:child_process";
import {existsSync, unlinkSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

export interface FreshImportTimingResult {
  elapsedMs: number;
  importPath: string;
  samplesMs: number[];
}

const UI_PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const PROBE_FILE = resolve(UI_PACKAGE_ROOT, "src/benchmarks/.fresh-import-probe.ts");

export const compareBenchmarkSamples = (left: number, right: number): number => left - right;

const runFreshImportSample = (importPath: string): number => {
  const probeSource = `
import {describe, expect, it} from "bun:test";

describe("fresh import timing", () => {
  it("imports target module", async () => {
    const start = performance.now();
    const moduleNamespace = await import(${JSON.stringify(importPath)});
    const elapsedMs = performance.now() - start;
    const exportCount = Object.keys(moduleNamespace).length;
    console.info("UI_IMPORT_TIMING_RESULT=" + JSON.stringify({elapsedMs, exportCount}));
    expect(exportCount).toBeGreaterThan(0);
  });
});
`;
  const childEnv: NodeJS.ProcessEnv = {...process.env, TZ: "America/New_York"};
  delete childEnv.BUN_OPTIONS;
  writeFileSync(PROBE_FILE, probeSource, "utf8");

  try {
    const result = spawnSync(
      "bun",
      ["test", "--preload", "./src/bunSetup.ts", "./src/benchmarks/.fresh-import-probe.ts"],
      {
        cwd: UI_PACKAGE_ROOT,
        encoding: "utf8",
        env: childEnv,
      }
    );

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const match = output.match(/UI_IMPORT_TIMING_RESULT=({.+})/);
    if (!match) {
      throw new Error(`Fresh import probe failed for ${importPath}\n${output.slice(0, 2000)}`);
    }

    const parsed = JSON.parse(match[1]) as {elapsedMs: number};
    return parsed.elapsedMs;
  } finally {
    if (existsSync(PROBE_FILE)) {
      unlinkSync(PROBE_FILE);
    }
  }
};

export const measureFreshImportTiming = ({
  importPath,
  sampleCount = 5,
  warmupCount = 1,
}: {
  importPath: string;
  sampleCount?: number;
  warmupCount?: number;
}): FreshImportTimingResult => {
  for (let index = 0; index < warmupCount; index += 1) {
    runFreshImportSample(importPath);
  }

  const samplesMs: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samplesMs.push(runFreshImportSample(importPath));
  }

  const sortedSamples = [...samplesMs].sort(compareBenchmarkSamples);

  return {
    elapsedMs: sortedSamples[Math.floor(sortedSamples.length / 2)] ?? 0,
    importPath,
    samplesMs,
  };
};
