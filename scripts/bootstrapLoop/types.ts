export type CheckStatus = "PASS" | "FAIL";

export interface StageCheck {
  name: string;
  status: CheckStatus;
  ev: string;
}

/** The one file format every stage run writes to `<runDir>/stages/<stage>.json`. */
export interface StageResult {
  stage: string;
  version: string;
  status: CheckStatus;
  attempt: number;
  startedAt: string;
  endedAt: string;
  minutes: number;
  checks: StageCheck[];
  log: string;
}

export interface RunStageOptions {
  stageId: string;
  version: string;
  runDir: string;
  failures?: string[];
}

export interface StageContext {
  version: string;
  runDir: string;
  appDir: string;
  failures: string[];
  env: NodeJS.ProcessEnv;
}

export interface StageOutcome {
  checks: StageCheck[];
  log: string;
}

export interface StageDefinition {
  id: string;
  kind: "agent" | "deterministic";
  run: (context: StageContext) => Promise<StageOutcome>;
}
