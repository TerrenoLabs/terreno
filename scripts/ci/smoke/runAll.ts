#!/usr/bin/env bun
/**
 * Runs every workspace's `smoke` script one at a time and prints each package's time.
 * Keeps going after a failure so one run reports every broken package, then exits 1.
 * Flags a smoke over the 30 s budget without failing it: local times are noisy, so the
 * CircleCI `smoke` job's table is the one that judges the budget.
 *
 * Usage:
 *   bun run smoke             # every workspace with a smoke script
 *   bun run smoke api rtk     # only these workspaces (directory names)
 */
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {DateTime} from "luxon";

export interface SmokeWorkspace {
  dir: string;
  name: string;
}

export interface SmokeResult extends SmokeWorkspace {
  durationMs: number;
  passed: boolean;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[];
}

const readPackageJson = (path: string): PackageJson =>
  JSON.parse(readFileSync(path, "utf8")) as PackageJson;

/** Workspaces, in root `workspaces` order, that define a `smoke` script. */
export const listSmokeWorkspaces = ({
  rootDir,
  only = [],
}: {
  rootDir: string;
  only?: string[];
}): SmokeWorkspace[] => {
  const workspaces = readPackageJson(join(rootDir, "package.json")).workspaces ?? [];
  const unknown = only.filter((dir) => !workspaces.includes(dir));
  if (unknown.length > 0) {
    throw new Error(`Unknown workspace(s): ${unknown.join(", ")}`);
  }
  const withSmoke = workspaces.flatMap((dir) => {
    const packageJsonPath = join(rootDir, dir, "package.json");
    if (!existsSync(packageJsonPath)) {
      return [];
    }
    const pkg = readPackageJson(packageJsonPath);
    return pkg.scripts?.smoke ? [{dir, name: pkg.name ?? dir}] : [];
  });
  const missing = only.filter((dir) => !withSmoke.some((workspace) => workspace.dir === dir));
  if (missing.length > 0) {
    throw new Error(`No smoke script in: ${missing.join(", ")}`);
  }
  return withSmoke.filter((workspace) => only.length === 0 || only.includes(workspace.dir));
};

/** Runs each workspace's `smoke` script in order, streaming its output, and times it. */
export const runSmokes = ({
  rootDir,
  workspaces,
}: {
  rootDir: string;
  workspaces: SmokeWorkspace[];
}): SmokeResult[] =>
  workspaces.map((workspace) => {
    console.info(`\n▶ ${workspace.name} (bun run --cwd ${workspace.dir} smoke)`);
    const startedAt = DateTime.now();
    const {exitCode} = Bun.spawnSync({
      cmd: [process.execPath, "run", "smoke"],
      cwd: join(rootDir, workspace.dir),
      stderr: "inherit",
      stdout: "inherit",
    });
    const durationMs = DateTime.now().diff(startedAt).toMillis();
    return {...workspace, durationMs, passed: exitCode === 0};
  });

/** Per-package smoke budget, excluding the build (docs/testing/e2e.md). */
const SMOKE_BUDGET_MS = 30_000;

const isOverBudget = (result: SmokeResult): boolean => result.durationMs > SMOKE_BUDGET_MS;

/** One line per package with its time and any budget overrun, then the counts. */
export const formatSummary = (results: SmokeResult[]): string => {
  const width = Math.max(...results.map((result) => result.name.length), 0);
  const budgetSeconds = SMOKE_BUDGET_MS / 1000;
  const lines = results.map((result) => {
    const line = `${result.passed ? "✅" : "❌"} ${result.name.padEnd(width)}  ${(result.durationMs / 1000).toFixed(1)} s`;
    return isOverBudget(result) ? `${line}  ⏱ over ${budgetSeconds} s budget` : line;
  });
  const failed = results.filter((result) => !result.passed).length;
  const overBudget = results.filter(isOverBudget).length;
  const counts = `${results.length - failed} passed, ${failed} failed`;
  lines.push(
    overBudget > 0 ? `${counts}, ${overBudget} over the ${budgetSeconds} s budget` : counts
  );
  return lines.join("\n");
};

const main = (): void => {
  const rootDir = join(import.meta.dir, "../../..");
  const workspaces = listSmokeWorkspaces({only: process.argv.slice(2), rootDir});
  if (workspaces.length === 0) {
    console.info("No workspace defines a smoke script.");
    return;
  }
  const results = runSmokes({rootDir, workspaces});
  console.info(`\nSmoke results\n${formatSummary(results)}`);
  if (results.some((result) => !result.passed)) {
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}
