import {DateTime} from "luxon";

export type ReviewStatus = "done" | "in_progress" | "pending" | "skipped";

export interface ReviewListItem {
  assigneeId?: string;
  enqueuedAt: string;
  evaluatorId: string;
  id: string;
  promptName?: string;
  reason: string;
  status: ReviewStatus;
  traceId: string;
  traceName: string;
}

export interface EvaluatorDimension {
  dataType: "boolean" | "categorical" | "numeric";
  key: string;
  range?: string;
  required: boolean;
}

export interface ReviewPanelField {
  key: string;
  label: string;
  note?: string;
  value: unknown;
}

export interface ReviewDetail {
  comment?: string;
  dimensions: EvaluatorDimension[];
  evaluatorId: string;
  id: string;
  instructions?: string;
  panels: {
    given: ReviewPanelField[];
    wrote: ReviewPanelField[];
  };
  rawInput?: unknown;
  rawOutput?: unknown;
  scores?: Record<string, boolean | number | string>;
  status: ReviewStatus;
  traceId: string;
}

export const REVIEW_STATUSES: ReviewStatus[] = ["pending", "in_progress", "done", "skipped"];

export const reviewStatusLabel = (status: ReviewStatus): string => {
  if (status === "in_progress") {
    return "In progress";
  }
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
};

export const unwrapReviewList = (raw: unknown): ReviewListItem[] => {
  if (Array.isArray(raw)) {
    return raw as ReviewListItem[];
  }
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const nested = (raw as Record<string, unknown>).data;
  return Array.isArray(nested) ? (nested as ReviewListItem[]) : [];
};

export const unwrapReviewCounts = (raw: unknown): Record<ReviewStatus, number> => {
  const empty = {done: 0, in_progress: 0, pending: 0, skipped: 0};
  if (!raw || typeof raw !== "object") {
    return empty;
  }
  const counts = (raw as Record<string, unknown>).counts;
  if (!counts || typeof counts !== "object") {
    return empty;
  }
  const record = counts as Record<string, unknown>;
  return {
    done: typeof record.done === "number" ? record.done : 0,
    in_progress: typeof record.in_progress === "number" ? record.in_progress : 0,
    pending: typeof record.pending === "number" ? record.pending : 0,
    skipped: typeof record.skipped === "number" ? record.skipped : 0,
  };
};

export const unwrapReviewDetail = (raw: unknown): ReviewDetail | undefined => {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if ("dimensions" in record && "panels" in record) {
    return record as unknown as ReviewDetail;
  }
  return unwrapReviewDetail(record.data);
};

export const unwrapCurrentUserId = (raw: unknown): string | undefined => {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id === "string") {
    return record.id;
  }
  return unwrapCurrentUserId(record.data ?? record.user);
};

export const waitingLabel = (enqueuedAt: string): string => {
  const start = DateTime.fromISO(enqueuedAt, {zone: "utc"});
  if (!start.isValid) {
    return "—";
  }
  const minutes = Math.max(0, Math.floor(DateTime.utc().diff(start, "minutes").minutes));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
};

export const wordCount = (value: unknown): number => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text?.trim() ? text.trim().split(/\s+/).length : 0;
};

export const displayReviewValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "—";
  }
  return JSON.stringify(value, null, 2);
};

export const numericRange = (range?: string): {max: number; min: number; step: number} => {
  const matches = range?.match(/(-?\d+(?:\.\d+)?)\s*(?:-|\.\.)\s*(-?\d+(?:\.\d+)?)/);
  const min = matches?.[1] ? Number(matches[1]) : 0;
  const max = matches?.[2] ? Number(matches[2]) : 1;
  return {max, min, step: max - min <= 1 ? 0.1 : 1};
};

export const categoricalOptions = (range?: string): string[] => {
  if (!range) {
    return [];
  }
  return range
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};
