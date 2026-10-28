import type {PromptDetail} from "../prompts/promptTypes";
import type {JudgeAgreement, ScoreValue} from "../review/batchTypes";

export type ExperimentKind = "judge" | "prompt";

export interface ExperimentEstimate {
  costUsd?: number;
  generations: number;
  wallClockSeconds: number;
}

export interface ScoreThreshold {
  /** `agreement` gates compare a judge prompt version's answers with human answers. */
  aggregate: "agreement" | "mean" | "trueRate";
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
  /** Judge experiments: agreement with the human answers, keyed by judge prompt version. */
  agreement?: Record<string, JudgeAgreement>;
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
  /** Judge experiments: the human answers each judge version is compared with. */
  humanScores?: Record<string, ScoreValue>;
  id: string;
  versionResults: Record<string, ExperimentVersionResult>;
}

export interface ExperimentRecord {
  backgroundTaskId?: string;
  created: string;
  datasetId: string;
  datasetName?: string;
  estimate?: ExperimentEstimate;
  evaluatorIds: string[];
  id: string;
  includeUnproofread: boolean;
  items: ExperimentItemRecord[];
  /** Judge experiments: the llm-judge evaluator whose prompt versions are compared. */
  judgeEvaluatorId?: string;
  judgeName?: string;
  /** Older payloads leave it out; treat a missing kind as a prompt comparison. */
  kind?: ExperimentKind;
  modelOverride?: string;
  name: string;
  /** The compared prompt; for judge experiments, the judge's prompt. */
  promptName: string;
  /** Judge experiments: the human question set whose answers are the reference. */
  questionSetId?: string;
  questionSetName?: string;
  /** Judge experiments: true when the questions changed after the run. */
  questionsStale?: boolean;
  results?: ExperimentAggregates;
  status: "completed" | "failed" | "pending" | "running";
  /** Judge experiments: agreement rate (0–1) a version must reach to pass. */
  targetAgreement?: number;
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

const gatesForVersion = (experiment: ExperimentRecord, version: number): ExperimentGateResult[] => {
  if (!experiment.results) {
    return [];
  }
  return experiment.results.gates.filter((gate) => gate.version === version);
};

const GATE_OP_SYMBOLS: Record<string, string> = {
  eq: "=",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

/** Show a gate comparison operator as the math symbol people read, never the API word. */
const formatGateOp = (op: string): string => {
  return GATE_OP_SYMBOLS[op] ?? op;
};

/** Show a measured gate value with two decimals, or a dash before any scores arrive. */
export const formatGateActual = (actual?: number): string => {
  if (actual === undefined || Number.isNaN(actual)) {
    return "—";
  }
  return actual.toFixed(2);
};

/** The threshold a gate needs, such as "≥ 0.8". */
export const formatGateThreshold = (gate: Pick<ScoreThreshold, "op" | "value">): string => {
  return `${formatGateOp(gate.op)} ${gate.value}`;
};

const humanizeIdentifier = (value: string): string => {
  return value.replace(/[_-]+/g, " ").trim();
};

/**
 * Name a gate in plain words. When the evaluator and dimension share a name ("helpfulness"),
 * say it once; otherwise "correctness: correct" or "schema-assert: schema valid".
 */
export const formatGateName = (
  gate: Pick<ScoreThreshold, "dimension" | "evaluatorName">
): string => {
  const dimension = humanizeIdentifier(gate.dimension);
  if (humanizeIdentifier(gate.evaluatorName).toLowerCase() === dimension.toLowerCase()) {
    return dimension;
  }
  return `${gate.evaluatorName}: ${dimension}`;
};

/** What the measured number is: the average score, or the share of items scored true. */
export const formatGateAggregate = (aggregate: ScoreThreshold["aggregate"]): string => {
  if (aggregate === "agreement") {
    return "Agreement";
  }
  return aggregate === "trueRate" ? "Pass rate" : "Average";
};

/** One failing gate in a sentence, such as "helpfulness ≥ 0.8 (got 0.62)". */
const describeGateResult = (gate: ExperimentGateResult): string => {
  return `${formatGateName(gate)} ${formatGateThreshold(gate)} (got ${formatGateActual(gate.actual)})`;
};

const pluralize = (count: number, singular: string, plural: string): string => {
  return `${count} ${count === 1 ? singular : plural}`;
};

export interface VersionGateSummary {
  failing: ExperimentGateResult[];
  gates: ExperimentGateResult[];
  passed: boolean;
  version: number;
}

/** Gate results for every compared version, in version order, with pass/fail rolled up. */
export const summarizeGatesByVersion = (experiment: ExperimentRecord): VersionGateSummary[] => {
  return [...experiment.versions]
    .sort((left, right) => left - right)
    .map((version) => {
      const gates = gatesForVersion(experiment, version);
      const failing = gates.filter((gate) => !gate.passed);
      return {failing, gates, passed: gates.length > 0 && failing.length === 0, version};
    });
};

/** Short verdict for one version's gates, such as "Fails 1 of 3 gates". */
export const formatVersionGateVerdict = (summary: VersionGateSummary): string => {
  if (summary.gates.length === 0) {
    return "No gates";
  }
  if (summary.failing.length === 0) {
    return summary.gates.length === 1
      ? "Passes its gate"
      : `Passes all ${summary.gates.length} gates`;
  }
  return `Fails ${summary.failing.length} of ${pluralize(summary.gates.length, "gate", "gates")}`;
};

/**
 * Explain why a version cannot be promoted, such as
 * "v1 fails 1 gate: helpfulness ≥ 0.8 (got 0.62) — can't promote v1."
 */
export const formatPromoteBlockedReason = (summary: VersionGateSummary): string | undefined => {
  if (summary.failing.length === 0) {
    return undefined;
  }
  const details = summary.failing.map(describeGateResult).join("; ");
  return `v${summary.version} fails ${pluralize(summary.failing.length, "gate", "gates")}: ${details} — can't promote v${summary.version}.`;
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

const ITEM_COLUMN_WIDTH = 120;
const PASS_COLUMN_WIDTH = 80;
const MIN_OUTPUT_COLUMN_WIDTH = 180;

export interface ExperimentItemColumnWidths {
  item: number;
  output: number;
  pass: number;
}

/**
 * Split the measured table width so the per-version output columns take every pixel the item and
 * pass columns leave over, never narrower than the readable minimum.
 */
export const experimentItemColumnWidths = ({
  containerWidth,
  versionCount,
}: {
  containerWidth: number;
  versionCount: number;
}): ExperimentItemColumnWidths => {
  const fixedWidth = ITEM_COLUMN_WIDTH + PASS_COLUMN_WIDTH * versionCount;
  const available = containerWidth - fixedWidth;
  const output =
    versionCount > 0
      ? Math.max(MIN_OUTPUT_COLUMN_WIDTH, Math.floor(available / versionCount))
      : MIN_OUTPUT_COLUMN_WIDTH;
  return {item: ITEM_COLUMN_WIDTH, output, pass: PASS_COLUMN_WIDTH};
};

export const DEFAULT_TARGET_AGREEMENT = 0.9;

export const EXPERIMENT_KIND_LABELS: Record<ExperimentKind, string> = {
  judge: "Judge calibration",
  prompt: "Prompt comparison",
};

export const experimentKind = (experiment: Pick<ExperimentRecord, "kind">): ExperimentKind => {
  return experiment.kind === "judge" ? "judge" : "prompt";
};

const formatAgreementPercent = (rate?: number): string => {
  if (rate === undefined || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 1000) / 10}%`;
};

export interface JudgeVersionSummary {
  agreement?: JudgeAgreement;
  meetsTarget: boolean;
  target: number;
  verdict: string;
  version: number;
}

/**
 * Plain-language verdict per judge prompt version, such as
 * "v2 agrees with humans 95% of the time — meets the 90% target."
 */
export const summarizeJudgeVersions = (experiment: ExperimentRecord): JudgeVersionSummary[] => {
  const target = experiment.targetAgreement ?? DEFAULT_TARGET_AGREEMENT;
  const targetText = formatAgreementPercent(target);
  return [...experiment.versions]
    .sort((left, right) => left - right)
    .map((version) => {
      const agreement = experiment.results?.agreement?.[String(version)];
      const rate = agreement?.rate;
      if (rate === undefined || Number.isNaN(rate)) {
        return {
          agreement,
          meetsTarget: false,
          target,
          verdict: `v${version} has no answers to compare with the humans yet.`,
          version,
        };
      }
      const meetsTarget = rate >= target;
      const verdict = `v${version} agrees with humans ${formatAgreementPercent(rate)} of the time — ${
        meetsTarget ? "meets" : "below"
      } the ${targetText} target.`;
      return {agreement, meetsTarget, target, verdict, version};
    });
};

/** The version with the highest agreement rate, if any version has one. */
export const bestJudgeVersion = (summaries: JudgeVersionSummary[]): number | undefined => {
  let best: JudgeVersionSummary | undefined;
  for (const summary of summaries) {
    const rate = summary.agreement?.rate;
    if (rate === undefined) {
      continue;
    }
    if (!best || rate > (best.agreement?.rate ?? -1)) {
      best = summary;
    }
  }
  return best?.version;
};

/** Tags shown next to a prompt version in pickers: latest, production, superseded. */
export const promptVersionTags = (version: number, detail?: PromptDetail): string[] => {
  const tags: string[] = [];
  if (!detail || detail.versions.length === 0) {
    return tags;
  }
  const latest = Math.max(...detail.versions.map((entry) => entry.version));
  if (version === latest) {
    tags.push("latest");
  }
  if (detail.labels.some((label) => label.label === "production" && label.version === version)) {
    tags.push("production");
  }
  if (version < latest - 1) {
    tags.push("superseded");
  }
  return tags;
};

/** "v1 and v2" or "v1, v2, and v3". */
export const formatVersionList = (versions: number[]): string => {
  const labels = [...versions].sort((left, right) => left - right).map((version) => `v${version}`);
  if (labels.length <= 2) {
    return labels.join(" and ");
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
};

/** Parse a target agreement typed as a percent ("90") into a rate (0.9), or undefined if invalid. */
export const parseTargetAgreementPercent = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    return undefined;
  }
  return parsed / 100;
};
