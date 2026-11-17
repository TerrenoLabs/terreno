import type {ScoreResult} from "../score/score";

export interface RunSnapshot {
  version: string;
  score: ScoreResult;
  /** Scoring passes the loop needed. */
  iterations: number;
  /** Scaffold file tree, relative paths. */
  files: string[];
}

export interface RowRegression {
  row: string;
  from: string;
  to: string;
  reason: string;
}

export interface IterationRegression {
  from: string;
  to: string;
  previous: number;
  now: number;
}

export interface TimeRegression {
  scope: string;
  previous: number;
  now: number;
}

export interface RunDiff {
  from: string;
  to: string;
  rowRegressions: RowRegression[];
  iterationRegressions: IterationRegression[];
  timeRegressions: TimeRegression[];
  removedFiles: string[];
}

/** Regressions from `prev` to `next`: PASS→FAIL rows, more iterations, time, removed files. */
export const diffRuns = (prev: RunSnapshot, next: RunSnapshot): RunDiff => {
  const previousRows = new Map(prev.score.rows.map((row) => [row.row, row.status]));
  const rowRegressions = next.score.rows
    .filter((row) => row.status === "FAIL" && previousRows.get(row.row) === "PASS")
    .map((row) => ({from: prev.version, reason: row.reason, row: row.row, to: next.version}));

  const iterationRegressions =
    next.iterations > prev.iterations
      ? [{from: prev.version, now: next.iterations, previous: prev.iterations, to: next.version}]
      : [];

  const timeRegressions: TimeRegression[] = next.score.times.stages
    .filter((stage) => stage.regressed && stage.previous !== undefined)
    .map((stage) => ({
      now: stage.totalMinutes,
      previous: stage.previous as number,
      scope: stage.id,
    }));
  if (next.score.times.totalRegressed && next.score.times.previousTotal !== undefined) {
    timeRegressions.push({
      now: next.score.times.totalMinutes,
      previous: next.score.times.previousTotal,
      scope: "total",
    });
  }

  const nextFiles = new Set(next.files);
  const removedFiles = prev.files.filter((file) => !nextFiles.has(file)).sort();

  return {
    from: prev.version,
    iterationRegressions,
    removedFiles,
    rowRegressions,
    timeRegressions,
    to: next.version,
  };
};

export const hasRegressions = (diff: RunDiff): boolean =>
  diff.rowRegressions.length +
    diff.iterationRegressions.length +
    diff.timeRegressions.length +
    diff.removedFiles.length >
  0;
