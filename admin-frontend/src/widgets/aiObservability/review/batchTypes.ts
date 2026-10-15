import type {EvaluatorDimension, ReviewStatus} from "./reviewTypes";

export type ScoreValue = boolean | number | string;

export interface JudgeQuestionAgreement {
  compared: number;
  covered: boolean;
  key: string;
  matches: number;
  question?: string;
  rate?: number;
}

export interface JudgeDisagreement {
  human: ScoreValue;
  judge?: ScoreValue;
  key: string;
  traceId: string;
}

export interface JudgeAgreement {
  compared: number;
  disagreements: JudgeDisagreement[];
  errors: number;
  itemsCompared: number;
  matches: number;
  questions: JudgeQuestionAgreement[];
  rate?: number;
}

export interface ReviewBatchJudgeSummary {
  agreement: JudgeAgreement;
  completedAt: string;
  evaluatorId: string;
  evaluatorName: string;
  judgePromptName?: string;
  modelId?: string;
  runId: string;
}

export interface ReviewBatchCounts {
  done: number;
  pending: number;
  skipped: number;
  total: number;
}

export interface ReviewBatchListItem {
  bestJudge?: {evaluatorName: string; rate?: number};
  counts: ReviewBatchCounts;
  created: string;
  description?: string;
  evaluatorId: string;
  evaluatorName: string;
  id: string;
  judgeCount: number;
  name: string;
  promptName?: string;
}

export interface ReviewBatchItem {
  input?: unknown;
  judgeAnswers: Record<string, {error?: string; scores?: Record<string, ScoreValue>}>;
  output?: unknown;
  reviewItemId: string;
  scores?: Record<string, ScoreValue>;
  status: ReviewStatus;
  traceId: string;
  traceName: string;
}

export interface ReviewBatchDetail extends ReviewBatchListItem {
  dimensions: EvaluatorDimension[];
  instructions?: string;
  items: ReviewBatchItem[];
  judges: ReviewBatchJudgeSummary[];
}

export const DEFAULT_BATCH_SIZE = 10;

// Agreement at or above this rate is treated as "matches the humans".
const AGREEMENT_TRUSTED = 0.9;
const AGREEMENT_CLOSE = 0.75;

export const formatPercent = (rate?: number): string => {
  if (rate === undefined || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 100)}%`;
};

export const agreementStatus = (rate?: number): "error" | "neutral" | "success" | "warning" => {
  if (rate === undefined) {
    return "neutral";
  }
  if (rate >= AGREEMENT_TRUSTED) {
    return "success";
  }
  if (rate >= AGREEMENT_CLOSE) {
    return "warning";
  }
  return "error";
};

export const agreementVerdict = (rate?: number): string => {
  if (rate === undefined) {
    return "No human answers yet";
  }
  if (rate >= AGREEMENT_TRUSTED) {
    return "Matches humans";
  }
  if (rate >= AGREEMENT_CLOSE) {
    return "Close — check disagreements";
  }
  return "Does not match humans";
};

const toBoolean = (value: ScoreValue | undefined): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "yes") {
    return true;
  }
  if (value === "false" || value === "no") {
    return false;
  }
  return undefined;
};

/** Mirrors the backend agreement rule so item cells flag the same disagreements. */
export const answerMatches = (
  dimension: EvaluatorDimension,
  human: ScoreValue,
  judge: ScoreValue | undefined
): boolean => {
  if (judge === undefined) {
    return false;
  }
  if (dimension.dataType === "boolean") {
    const humanBool = toBoolean(human);
    return humanBool !== undefined && humanBool === toBoolean(judge);
  }
  if (dimension.dataType === "numeric") {
    const matches = dimension.range?.match(/(-?\d+(?:\.\d+)?)\s*(?:-|\.\.)\s*(-?\d+(?:\.\d+)?)/);
    const span = matches ? Math.abs(Number(matches[2]) - Number(matches[1])) || 1 : 1;
    return Math.abs(Number(human) - Number(judge)) <= span * 0.1 + 1e-9;
  }
  return String(human).trim().toLowerCase() === String(judge).trim().toLowerCase();
};

export const formatAnswer = (value: ScoreValue | undefined): string => {
  if (value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
};

export const previewText = (value: unknown, max = 90): string => {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const unwrapData = (raw: unknown): unknown => {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "data" in raw) {
    return (raw as {data: unknown}).data;
  }
  return raw;
};

export const unwrapBatchList = (raw: unknown): ReviewBatchListItem[] => {
  const data = unwrapData(raw);
  return Array.isArray(data) ? (data as ReviewBatchListItem[]) : [];
};

export const unwrapBatchDetail = (raw: unknown): ReviewBatchDetail | undefined => {
  const data = unwrapData(raw);
  if (data && typeof data === "object" && "items" in data && "judges" in data) {
    return data as ReviewBatchDetail;
  }
  return undefined;
};
