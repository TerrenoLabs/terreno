import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {DateTime} from "luxon";

import {runStage as defaultRunStage} from "./runStage";
import {stagesDir} from "./stageResult";
import {stageIds} from "./stages";
import type {RunStageOptions, StageResult} from "./types";

export interface BuildStageSummary {
  id: string;
  status: "PASS" | "FAIL";
  attempts: number;
  firstPassMinutes: number;
  totalMinutes: number;
}

export interface BuildResult {
  version: string;
  stages: BuildStageSummary[];
  totalMinutes: number;
  startedAt: string;
  endedAt: string;
}

export interface RunBuildOptions {
  version: string;
  runDir: string;
  from?: string;
  only?: string[];
  keepGoing?: boolean;
  /** Injected in tests; defaults to the real stage runner. */
  runStage?: (options: RunStageOptions) => Promise<StageResult>;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** Every attempt of a stage in this run dir, oldest first: `<id>.<n>.json` then `<id>.json`. */
const readAttempts = (runDir: string, id: string): StageResult[] => {
  const dir = stagesDir(runDir);
  if (!existsSync(dir)) {
    return [];
  }
  const files = readdirSync(dir).filter(
    (file) => file === `${id}.json` || new RegExp(`^${id}\\.\\d+\\.json$`).test(file)
  );
  return files
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as StageResult)
    .sort((a, b) => a.attempt - b.attempt);
};

export const summarizeStage = (runDir: string, id: string): BuildStageSummary | undefined => {
  const attempts = readAttempts(runDir, id);
  if (attempts.length === 0) {
    return undefined;
  }
  return {
    attempts: attempts.length,
    firstPassMinutes: attempts[0].minutes,
    id,
    status: attempts[attempts.length - 1].status,
    totalMinutes: round(attempts.reduce((sum, attempt) => sum + attempt.minutes, 0)),
  };
};

/** Stage ids to run, in registry order, after applying `from` and `only`. */
export const selectStages = ({from, only}: Pick<RunBuildOptions, "from" | "only">): string[] => {
  const all = stageIds();
  for (const id of [from, ...(only ?? [])]) {
    if (id && !all.includes(id)) {
      throw new Error(`unknown stage "${id}"; valid stages: ${all.join(", ")}`);
    }
  }
  const start = from ? all.indexOf(from) : 0;
  return all.slice(start).filter((id) => !only || only.includes(id));
};

/** Runs the stages in order and writes `<runDir>/build.json`. */
export const runBuild = async ({
  version,
  runDir,
  from,
  only,
  keepGoing = false,
  runStage = defaultRunStage,
}: RunBuildOptions): Promise<BuildResult> => {
  const selected = selectStages({from, only});
  mkdirSync(runDir, {recursive: true});
  const started = DateTime.now();
  for (const stageId of selected) {
    const result = await runStage({runDir, stageId, version});
    if (result.status === "FAIL" && !keepGoing) {
      break;
    }
  }
  const stages = stageIds()
    .map((id) => summarizeStage(runDir, id))
    .filter((summary): summary is BuildStageSummary => Boolean(summary));
  const build: BuildResult = {
    endedAt: DateTime.now().toISO() as string,
    stages,
    startedAt: started.toISO() as string,
    totalMinutes: round(stages.reduce((sum, stage) => sum + stage.totalMinutes, 0)),
    version,
  };
  writeFileSync(join(runDir, "build.json"), `${JSON.stringify(build, null, 2)}\n`);
  return build;
};

/** A build passes when every stage that ran in this call ended PASS. */
export const buildPassed = (build: BuildResult, ran: string[]): boolean =>
  ran.every((id) => build.stages.find((stage) => stage.id === id)?.status === "PASS");
