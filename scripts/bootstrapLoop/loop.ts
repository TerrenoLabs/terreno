import {execFileSync} from "node:child_process";
import {appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DateTime} from "luxon";

import {type BuildResult, runBuild as defaultRunBuild} from "./build";
import {scoreBuild as defaultScoreBuild, type ScoreResult} from "./score/score";

export const DEFAULT_MAX_ITERATIONS = 3;

/** The stage that owns each rubric row (see the stage table in the plan). */
const ROW_OWNER: Readonly<Record<string, string>> = {
  R1: "admin",
  R2: "auth",
  R3: "theming",
  R4: "theming",
  R5: "ai",
  R6: "consent",
  R7: "features",
  R8: "roles",
  R9: "ci",
  R10: "ai",
  R11: "checklist",
  R12: "admin",
  R13: "deploy",
};

interface IterationLog {
  iteration: number;
  failedRows: string[];
  rerunStages: string[];
  changedFiles: string[];
  score: {passCount: number; total: number};
  minutes: number;
}

export interface RunLoopOptions {
  version: string;
  runDir: string;
  maxIterations?: number;
  previousRunDir?: string;
  /** Injected in tests; default to the real build and scorer. */
  runBuild?: typeof defaultRunBuild;
  scoreBuild?: typeof defaultScoreBuild;
  env?: NodeJS.ProcessEnv;
}

export interface LoopResult {
  pass: boolean;
  iterations: IterationLog[];
}

const round = (value: number): number => Math.round(value * 10) / 10;

const git = (appDir: string, args: string[], env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync("git", args, {
    cwd: appDir,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** Hash of the app's working tree (tracked and untracked, ignores respected), via a throwaway index. */
const snapshotTree = (appDir: string): string | undefined => {
  if (!existsSync(join(appDir, ".git"))) {
    return undefined;
  }
  const scratch = mkdtempSync(join(tmpdir(), "bootstrap-loop-index-"));
  try {
    const env = {...process.env, GIT_INDEX_FILE: join(scratch, "index")};
    git(appDir, ["add", "-A"], env);
    return git(appDir, ["write-tree"], env).trim();
  } catch {
    return undefined;
  } finally {
    rmSync(scratch, {force: true, recursive: true});
  }
};

/** Files that differ between two tree snapshots. */
const changedBetween = (
  appDir: string,
  before: string | undefined,
  after: string | undefined
): string[] => {
  if (!before || !after) {
    return [];
  }
  try {
    return git(appDir, ["diff-tree", "-r", "--name-only", before, after])
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

/** Files the first build changed relative to the scaffold's baseline commit. */
const changedSinceBaseline = (appDir: string, after: string | undefined): string[] => {
  if (!after) {
    return [];
  }
  try {
    return git(appDir, ["diff-tree", "-r", "--name-only", "HEAD", after])
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

const failuresFor = (score: ScoreResult, stageId: string): string[] =>
  score.rows
    .filter((row) => row.status === "FAIL" && ROW_OWNER[row.row] === stageId)
    .map((row) => `${row.row}: ${row.reason}`);

const renderIterations = (version: string, iterations: IterationLog[]): string => {
  const lines = [`# Iterations for ${version}`, ""];
  for (const item of iterations) {
    lines.push(
      `## Iteration ${String(item.iteration)}`,
      "",
      `- Failed rows: ${item.failedRows.join(", ") || "none"}`,
      `- Stages rerun: ${item.rerunStages.join(", ") || "none (first build)"}`,
      `- Changed files: ${item.changedFiles.length === 0 ? "none" : item.changedFiles.join(", ")}`,
      `- Score: ${String(item.score.passCount)}/${String(item.score.total)} rows pass`,
      `- Minutes: ${String(item.minutes)}`,
      ""
    );
  }
  return lines.join("\n");
};

const stagesNeedingRerun = (score: ScoreResult, build: BuildResult): string[] => {
  const owners = score.rows
    .filter((row) => row.status === "FAIL")
    .map((row) => ROW_OWNER[row.row])
    .filter((id): id is string => Boolean(id));
  const failedStages = build.stages
    .filter((stage) => stage.status === "FAIL")
    .map((stage) => stage.id);
  return [...new Set([...owners, ...failedStages])];
};

/**
 * Builds, scores, and while the rubric fails reruns the owning stages of the failing rows
 * (their reasons as `failures`) and rescores, up to `maxIterations` scoring passes.
 */
export const runLoop = async ({
  version,
  runDir,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  previousRunDir,
  runBuild = defaultRunBuild,
  scoreBuild = defaultScoreBuild,
  env = process.env,
}: RunLoopOptions): Promise<LoopResult> => {
  const appDir = join(runDir, "app");
  const iterations: IterationLog[] = [];
  const logPath = join(runDir, "iterations.jsonl");
  writeFileSync(logPath, "");

  let rerun: string[] = [];
  let failures: Record<string, string[]> = {};
  let treeBefore: string | undefined;
  let pass = false;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const started = DateTime.now();
    let build: BuildResult;
    if (iteration === 1) {
      build = await runBuild({keepGoing: true, runDir, version});
    } else {
      build = await runBuild({failures, keepGoing: true, only: rerun, runDir, version});
    }
    const score = await scoreBuild({env, previousDir: previousRunDir, runDir});
    const treeAfter = snapshotTree(appDir);
    const failedRows = score.rows.filter((row) => row.status === "FAIL").map((row) => row.row);
    const entry: IterationLog = {
      changedFiles:
        iteration === 1
          ? changedSinceBaseline(appDir, treeAfter)
          : changedBetween(appDir, treeBefore, treeAfter),
      failedRows,
      iteration,
      minutes: round(DateTime.now().diff(started, "minutes").minutes),
      rerunStages: iteration === 1 ? [] : rerun,
      score: {passCount: score.rows.length - failedRows.length, total: score.rows.length},
    };
    iterations.push(entry);
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    writeFileSync(join(runDir, "ITERATIONS.md"), renderIterations(version, iterations));
    treeBefore = treeAfter;

    if (score.pass) {
      pass = true;
      break;
    }
    rerun = stagesNeedingRerun(score, build);
    failures = Object.fromEntries(rerun.map((id) => [id, failuresFor(score, id)]));
  }
  return {iterations, pass};
};
