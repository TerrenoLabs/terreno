import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import type {StageResult} from "./types";

export const stagesDir = (runDir: string): string => join(runDir, "stages");

export const stageFile = (runDir: string, stage: string): string =>
  join(stagesDir(runDir), `${stage}.json`);

export const readStageResult = (runDir: string, stage: string): StageResult | undefined => {
  const path = stageFile(runDir, stage);
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, "utf8")) as StageResult;
};

/** Attempt number for the next run of this stage: one past the file already on disk. */
export const nextAttempt = (runDir: string, stage: string): number => {
  const previous = readStageResult(runDir, stage);
  return previous ? previous.attempt + 1 : 1;
};

/** Writes the stage JSON, first keeping a previous run as `<stage>.<attempt>.json`. */
export const writeStageResult = (runDir: string, result: StageResult): string => {
  mkdirSync(stagesDir(runDir), {recursive: true});
  const path = stageFile(runDir, result.stage);
  const previous = readStageResult(runDir, result.stage);
  if (previous) {
    renameSync(path, join(stagesDir(runDir), `${result.stage}.${previous.attempt}.json`));
  }
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
};
