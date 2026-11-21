import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {join, relative} from "node:path";

import {runLoop as defaultRunLoop, type LoopResult} from "../loop";
import type {ScoreResult} from "../score/score";
import {diffRuns, type RunDiff, type RunSnapshot} from "./diff";
import {renderReport} from "./report";

export interface RunMatrixOptions {
  versions: string[];
  /** Scratch root for run dirs: `<workRoot>/<version>`. */
  workRoot: string;
  /** Where REGRESSIONS.md and runs/<version>/ land (docs/bootstrapLoop). */
  outDir: string;
  maxIterations?: number;
  runLoop?: (options: {
    version: string;
    runDir: string;
    maxIterations?: number;
    previousRunDir?: string;
  }) => Promise<LoopResult>;
}

export interface MatrixResult {
  snapshots: RunSnapshot[];
  diffs: RunDiff[];
  reportPath: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel"]);

/** Relative paths of every file in the scaffold, ignoring dependencies and VCS state. */
const listTree = (root: string): string[] => {
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".env")) {
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        out.push(relative(root, full));
      }
    }
  };
  walk(root);
  return out.sort();
};

const readIterations = (runDir: string): number => {
  const path = join(runDir, "iterations.jsonl");
  if (!existsSync(path)) {
    return 0;
  }
  return readFileSync(path, "utf8").split("\n").filter(Boolean).length;
};

const publish = (runDir: string, outDir: string, version: string, files: string[]): void => {
  const dest = join(outDir, "runs", version);
  mkdirSync(dest, {recursive: true});
  for (const name of ["score.json", "SCORE.md", "ITERATIONS.md", "build.json"]) {
    if (existsSync(join(runDir, name))) {
      cpSync(join(runDir, name), join(dest, name));
    }
  }
  writeFileSync(join(dest, "tree.txt"), `${files.join("\n")}\n`);
};

/** Runs the loop per version in order, each against the previous run, then writes the report. */
export const runMatrix = async ({
  versions,
  workRoot,
  outDir,
  maxIterations,
  runLoop = defaultRunLoop,
}: RunMatrixOptions): Promise<MatrixResult> => {
  const snapshots: RunSnapshot[] = [];
  const diffs: RunDiff[] = [];
  let previousRunDir: string | undefined;
  for (const version of versions) {
    const runDir = join(workRoot, version);
    mkdirSync(runDir, {recursive: true});
    const result = await runLoop({maxIterations, previousRunDir, runDir, version});
    const scorePath = join(runDir, "score.json");
    if (!existsSync(scorePath)) {
      throw new Error(`loop for ${version} wrote no score.json`);
    }
    const score = JSON.parse(readFileSync(scorePath, "utf8")) as ScoreResult;
    const files = listTree(join(runDir, "app"));
    const snapshot: RunSnapshot = {
      files,
      iterations: result.iterations.length || readIterations(runDir),
      score,
      version,
    };
    publish(runDir, outDir, version, files);
    const previous = snapshots[snapshots.length - 1];
    if (previous) {
      diffs.push(diffRuns(previous, snapshot));
    }
    snapshots.push(snapshot);
    previousRunDir = runDir;
  }
  mkdirSync(outDir, {recursive: true});
  const reportPath = join(outDir, "REGRESSIONS.md");
  writeFileSync(reportPath, renderReport(snapshots, diffs));
  return {diffs, reportPath, snapshots};
};
