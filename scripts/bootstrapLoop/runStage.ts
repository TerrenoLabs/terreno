import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {DateTime} from "luxon";

import {redact} from "./redact";
import {nextAttempt, writeStageResult} from "./stageResult";
import {findStage, stageIds} from "./stages";
import type {RunStageOptions, StageResult} from "./types";

const appDirFor = (runDir: string): string => join(runDir, "app");

/** Runs one stage against `<runDir>/app` and writes `<runDir>/stages/<stage>.json`. */
export const runStage = async ({
  stageId,
  version,
  runDir,
  failures = [],
}: RunStageOptions): Promise<StageResult> => {
  const stage = findStage(stageId);
  if (!stage) {
    throw new Error(`unknown stage "${stageId}"; valid stages: ${stageIds().join(", ")}`);
  }
  mkdirSync(runDir, {recursive: true});
  const attempt = nextAttempt(runDir, stageId);
  const started = DateTime.now();
  const outcome = await stage
    .run({
      appDir: appDirFor(runDir),
      env: process.env,
      failures,
      runDir,
      version,
    })
    .catch((error: unknown) => ({
      checks: [
        {
          ev: error instanceof Error ? error.message : String(error),
          name: "stage-error",
          status: "FAIL" as const,
        },
      ],
      log: "",
    }));
  const ended = DateTime.now();
  const checks = outcome.checks.map((check) => ({...check, ev: redact(check.ev, process.env)}));
  const result: StageResult = {
    attempt,
    checks,
    endedAt: ended.toISO() as string,
    log: redact(outcome.log, process.env),
    minutes: Math.round(ended.diff(started, "minutes").minutes * 10) / 10,
    stage: stageId,
    startedAt: started.toISO() as string,
    status: checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL",
    version,
  };
  writeStageResult(runDir, result);
  return result;
};
