export interface ExperimentEstimate {
  costUsd?: number;
  generations: number;
  wallClockSeconds: number;
}

export interface ScoreThreshold {
  aggregate: "mean" | "trueRate";
  dimension: string;
  evaluatorName: string;
  op: "eq" | "gte" | "lte";
  value: number;
}

export interface ExperimentGateResult extends ScoreThreshold {
  actual?: number;
  passed: boolean;
  version: number;
}

export interface ExperimentAggregates {
  gates: ExperimentGateResult[];
  lowConfidenceItemIds: string[];
  outlierItemIds: string[];
  progress: {completed: number; total: number};
  totalCostUsd?: number;
}

export interface ExperimentVersionEvaluatorScore {
  confidence?: number;
  error?: string;
  scores?: Record<string, boolean | number | string>;
}

export interface ExperimentVersionResult {
  error?: string;
  evaluatorScores: Record<string, ExperimentVersionEvaluatorScore>;
  output?: unknown;
}

export interface ExperimentItemRecord {
  datasetItemId: string;
  failed: boolean;
  id: string;
  versionResults: Record<string, ExperimentVersionResult>;
}

export interface ExperimentRecord {
  backgroundTaskId?: string;
  created: string;
  datasetId: string;
  estimate?: ExperimentEstimate;
  evaluatorIds: string[];
  id: string;
  includeUnproofread: boolean;
  items: ExperimentItemRecord[];
  modelOverride?: string;
  name: string;
  promptName: string;
  results?: ExperimentAggregates;
  status: "completed" | "failed" | "pending" | "running";
  thresholds: ScoreThreshold[];
  updated: string;
  versions: number[];
}

export const unwrapObservabilityPayload = <T>(raw: unknown): T | undefined => {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "object" && "data" in raw) {
    return (raw as {data: T}).data;
  }
  return raw as T;
};

export const unwrapExperimentList = (raw: unknown): ExperimentRecord[] => {
  const payload = unwrapObservabilityPayload<ExperimentRecord[]>(raw);
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.filter((entry): entry is ExperimentRecord => {
    return Boolean(entry && typeof entry.id === "string");
  });
};

export const unwrapExperimentRecord = (raw: unknown): ExperimentRecord | undefined => {
  const payload = unwrapObservabilityPayload<ExperimentRecord>(raw);
  if (!payload || typeof payload.id !== "string") {
    return undefined;
  }
  return payload;
};

export const failingGateCount = (experiment: ExperimentRecord): number => {
  if (!experiment.results) {
    return 0;
  }
  return experiment.results.gates.filter((gate) => !gate.passed).length;
};

export const gatesForVersion = (
  experiment: ExperimentRecord,
  version: number
): ExperimentGateResult[] => {
  if (!experiment.results) {
    return [];
  }
  return experiment.results.gates.filter((gate) => gate.version === version);
};

export const experimentProgressPercent = (experiment: ExperimentRecord): number => {
  const progress = experiment.results?.progress;
  if (!progress || progress.total === 0) {
    return 0;
  }
  return Math.round((progress.completed / progress.total) * 100);
};

export const parsePromoteBlockedTitle = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const record = error as {data?: {status?: number; title?: string}; status?: number};
  const title = record.data?.title;
  const status = record.data?.status ?? record.status;
  if (status === 409 && title) {
    return title;
  }
  return title;
};

const MIN_EXPERIMENT_VERSIONS = 2;
const MAX_EXPERIMENT_VERSIONS = 3;

export const isAutomaticExperimentEvaluator = (evaluator: {type: string}): boolean => {
  return evaluator.type === "llm-judge" || evaluator.type === "json-assert";
};

export const isValidExperimentVersionCount = (count: number): boolean => {
  return count >= MIN_EXPERIMENT_VERSIONS && count <= MAX_EXPERIMENT_VERSIONS;
};
