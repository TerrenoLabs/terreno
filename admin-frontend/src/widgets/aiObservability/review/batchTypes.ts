import {
  AGREEMENT_LEVEL_STYLE,
  type AgreementLevel,
  formatRate,
  getAgreementLevel,
} from "../shell/observabilityStatus";
import type {EvaluatorDimension, ReviewListItem, ReviewStatus} from "./reviewTypes";

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
  /** Set when the answers pair by dataset item (dataset batches and judge experiments). */
  datasetItemId?: string;
  human: ScoreValue;
  judge?: ScoreValue;
  key: string;
  traceId?: string;
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
  /** Dataset the batch judges, when it was built from a dataset. */
  datasetId?: string;
  datasetName?: string;
  description?: string;
  evaluatorId: string;
  evaluatorName: string;
  id: string;
  judgeCount: number;
  name: string;
  promptName?: string;
  /** Question-set fingerprint when the batch was created (dataset batches). */
  questionsFingerprint?: string;
  /** True when the question set's questions changed after this dataset batch was created. */
  questionsStale?: boolean;
}

export interface ReviewBatchItem {
  datasetItemId?: string;
  input?: unknown;
  judgeAnswers: Record<string, {error?: string; scores?: Record<string, ScoreValue>}>;
  output?: unknown;
  reviewItemId: string;
  scores?: Record<string, ScoreValue>;
  status: ReviewStatus;
  /** Unset for a dataset item without a source trace. */
  traceId?: string;
  traceName: string;
}

export interface ReviewBatchDetail extends ReviewBatchListItem {
  dimensions: EvaluatorDimension[];
  instructions?: string;
  items: ReviewBatchItem[];
  judges: ReviewBatchJudgeSummary[];
}

export const DEFAULT_BATCH_SIZE = 10;

/** Key that pairs a human answer row with judge answers: the dataset item, else the trace. */
export const answerSubjectKey = (row: {datasetItemId?: string; traceId?: string}): string => {
  return row.datasetItemId ?? row.traceId ?? "";
};

/** The created batch's id from a create response, with or without a `data` envelope. */
export const unwrapCreatedBatchId = (raw: unknown): string | undefined => {
  const data = unwrapData(raw);
  if (data && typeof data === "object" && typeof (data as {id?: unknown}).id === "string") {
    return (data as {id: string}).id;
  }
  return undefined;
};

/** Batch items still awaiting an answer: pending or in progress, in batch order. */
export const openBatchItems = (items: ReviewListItem[]): ReviewListItem[] =>
  items.filter((item) => item.status === "pending" || item.status === "in_progress");

export const formatPercent = (rate?: number): string => formatRate(rate);

export const agreementStatus = (rate?: number): "error" | "neutral" | "success" | "warning" => {
  const tone = AGREEMENT_LEVEL_STYLE[getAgreementLevel(rate)].tone;
  return tone === "info" ? "neutral" : tone;
};

const AGREEMENT_VERDICT: Record<AgreementLevel, string> = {
  close: "Close — check disagreements",
  match: "Matches humans",
  none: "No human answers yet",
  off: "Does not match humans",
};

export const agreementVerdict = (rate?: number): string =>
  AGREEMENT_VERDICT[getAgreementLevel(rate)];

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
