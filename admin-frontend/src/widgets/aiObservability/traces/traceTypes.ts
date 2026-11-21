import {DateTime} from "luxon";

export interface TraceUsage {
  costUsd?: number;
  inputTokens?: number;
  model?: string;
  outputTokens?: number;
}

export interface TracePromptRef {
  label?: string;
  name: string;
  version: number;
}

export interface TraceListItem {
  endedAt?: string;
  errorSummary?: string;
  flaggedForDataset: boolean;
  id: string;
  name: string;
  prompts: TracePromptRef[];
  scoreCount: number;
  sensitive: boolean;
  sessionId?: string;
  spanCount: number;
  startedAt: string;
  status: "error" | "ok";
  tags?: string[];
  usage?: TraceUsage;
  userId?: string;
}

export interface TraceSpanNode {
  children: TraceSpanNode[];
  durationMs?: number;
  endedAt?: string;
  error?: string;
  id: string;
  input?: unknown;
  kind: string;
  name: string;
  output?: unknown;
  parentSpanId?: string;
  sensitive?: boolean;
  startedAt: string;
  startOffsetMs?: number;
  status: "error" | "ok";
  usage?: TraceUsage;
}

export interface TraceScore {
  comment?: string;
  confidence?: number;
  dataType: "boolean" | "categorical" | "numeric";
  name: string;
  source: string;
  value: boolean | number | string;
}

export interface TraceDetail extends TraceListItem {
  input?: unknown;
  output?: unknown;
  scores: TraceScore[];
  spans: TraceSpanNode[];
}

export interface TraceListResponse {
  data: TraceListItem[];
  limit: number;
  more: boolean;
  page: number;
  total: number;
}

/** Passive feedback signals the backend records as `user-signal` scores. */
export const TRACE_FEEDBACK_SIGNALS = [
  "accepted",
  "dismissed",
  "copied",
  "edited",
  "regenerated",
] as const;
export type TraceFeedbackSignal = (typeof TRACE_FEEDBACK_SIGNALS)[number];

export interface TraceListFilters {
  flaggedForDataset?: boolean;
  from: string;
  /** Traces with (or without) an end-user comment. */
  hasComment?: boolean;
  hasScore?: boolean;
  /** Prompt names; a trace matches when it used any of them. */
  prompts: string[];
  sensitive?: boolean;
  sessionId: string;
  /** A passive signal the user sent, e.g. `dismissed`. */
  signal?: TraceFeedbackSignal;
  status: "" | "error" | "ok";
  tag: string;
  /** End-user thumbs direction. */
  thumbs?: "down" | "up";
  to: string;
  userId: string;
}

export interface FlatSpan {
  depth: number;
  span: TraceSpanNode;
}

export interface EvaluatorOption {
  id: string;
  name: string;
  type: "human";
}

export const TRACE_PAGE_SIZE = 20;

/** Sort keys accepted by `GET /ai/observability/traces?sort=`; `-` prefix sorts descending. */
export type TraceSortKey =
  | "cost"
  | "latency"
  | "name"
  | "scores"
  | "spans"
  | "startedAt"
  | "status"
  | "tokens";

/** Newest first. */
export const DEFAULT_TRACE_SORT = "-startedAt";

/** DataTable filter field keys used by the Traces screen. */
export const TRACE_FILTER_FIELDS = {
  hasComment: "hasComment",
  hasScore: "hasScore",
  prompt: "prompt",
  sensitive: "sensitive",
  sessionId: "sessionId",
  signal: "signal",
  startedAt: "startedAt",
  status: "status",
  tag: "tag",
  thumbs: "thumbs",
  userId: "userId",
} as const;

export const emptyTraceFilters = (): TraceListFilters => ({
  from: "",
  prompts: [],
  sessionId: "",
  status: "",
  tag: "",
  to: "",
  userId: "",
});

const stringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry !== "");
  }
  if (typeof value === "string" && value.trim() !== "") {
    return [value.trim()];
  }
  return [];
};

const trimmedString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const optionalBoolean = (value: unknown): boolean | undefined => {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return undefined;
};

/** Maps list filters to the DataTable's controlled `filterValues`. */
export const traceFiltersToFilterValues = (filters: TraceListFilters): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  const fields = TRACE_FILTER_FIELDS;
  if (filters.status) {
    values[fields.status] = [filters.status];
  }
  if (filters.prompts.length > 0) {
    values[fields.prompt] = filters.prompts;
  }
  if (filters.from) {
    values[`${fields.startedAt}_gte`] = filters.from;
  }
  if (filters.to) {
    values[`${fields.startedAt}_lte`] = filters.to;
  }
  if (filters.sensitive !== undefined) {
    values[fields.sensitive] = filters.sensitive;
  }
  if (filters.hasScore !== undefined) {
    values[fields.hasScore] = filters.hasScore;
  }
  if (filters.thumbs) {
    values[fields.thumbs] = [filters.thumbs];
  }
  if (filters.signal) {
    values[fields.signal] = [filters.signal];
  }
  if (filters.hasComment !== undefined) {
    values[fields.hasComment] = filters.hasComment;
  }
  if (filters.userId) {
    values[fields.userId] = filters.userId;
  }
  if (filters.sessionId) {
    values[fields.sessionId] = filters.sessionId;
  }
  if (filters.tag) {
    values[fields.tag] = filters.tag;
  }
  return values;
};

/**
 * Maps DataTable `filterValues` back to list filters. Picking both statuses means no status
 * filter. Filters the table does not show (`flaggedForDataset`) carry over from `previous`.
 */
export const filterValuesToTraceFilters = (
  values: Record<string, unknown>,
  previous?: TraceListFilters
): TraceListFilters => {
  const fields = TRACE_FILTER_FIELDS;
  const statuses = stringList(values[fields.status]).filter(
    (entry): entry is "error" | "ok" => entry === "error" || entry === "ok"
  );
  const filters: TraceListFilters = {
    from: trimmedString(values[`${fields.startedAt}_gte`]),
    prompts: stringList(values[fields.prompt]),
    sessionId: trimmedString(values[fields.sessionId]),
    status: statuses.length === 1 ? (statuses[0] ?? "") : "",
    tag: trimmedString(values[fields.tag]),
    to: trimmedString(values[`${fields.startedAt}_lte`]),
    userId: trimmedString(values[fields.userId]),
  };
  const sensitive = optionalBoolean(values[fields.sensitive]);
  if (sensitive !== undefined) {
    filters.sensitive = sensitive;
  }
  const hasScore = optionalBoolean(values[fields.hasScore]);
  if (hasScore !== undefined) {
    filters.hasScore = hasScore;
  }
  // Choice filters: one picked value narrows; none (Any) or several means no filter.
  const thumbs = stringList(values[fields.thumbs]).filter(
    (entry): entry is "down" | "up" => entry === "down" || entry === "up"
  );
  if (thumbs.length === 1) {
    filters.thumbs = thumbs[0];
  }
  const signals = stringList(values[fields.signal]).filter((entry): entry is TraceFeedbackSignal =>
    (TRACE_FEEDBACK_SIGNALS as readonly string[]).includes(entry)
  );
  if (signals.length === 1) {
    filters.signal = signals[0];
  }
  const hasComment = optionalBoolean(values[fields.hasComment]);
  if (hasComment !== undefined) {
    filters.hasComment = hasComment;
  }
  if (previous?.flaggedForDataset !== undefined) {
    filters.flaggedForDataset = previous.flaggedForDataset;
  }
  return filters;
};

export const unwrapTraceList = (raw: unknown): TraceListResponse => {
  if (Array.isArray(raw)) {
    return {
      data: raw as TraceListItem[],
      limit: TRACE_PAGE_SIZE,
      more: false,
      page: 1,
      total: raw.length,
    };
  }
  if (!raw || typeof raw !== "object") {
    return {data: [], limit: TRACE_PAGE_SIZE, more: false, page: 1, total: 0};
  }
  const record = raw as Record<string, unknown>;
  const nested = record.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested) && "data" in nested) {
    return unwrapTraceList(nested);
  }
  const rows = Array.isArray(nested)
    ? (nested as TraceListItem[])
    : Array.isArray(raw)
      ? (raw as TraceListItem[])
      : [];
  const page = typeof record.page === "number" ? record.page : 1;
  const limit = typeof record.limit === "number" ? record.limit : TRACE_PAGE_SIZE;
  const total = typeof record.total === "number" ? record.total : rows.length;
  const more = typeof record.more === "boolean" ? record.more : page * limit < total;
  return {data: rows, limit, more, page, total};
};

export const unwrapTraceDetail = (raw: unknown): TraceDetail | undefined => {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if ("name" in record && "spans" in record) {
    return raw as TraceDetail;
  }
  if (record.data && typeof record.data === "object") {
    return unwrapTraceDetail(record.data);
  }
  return undefined;
};

export const unwrapEvaluators = (raw: unknown): EvaluatorOption[] => {
  const payload =
    raw && typeof raw === "object" && "data" in raw ? (raw as {data: unknown}).data : raw;
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }
      const row = entry as {id?: string; name?: string; type?: string};
      if (!row.id || !row.name || row.type !== "human") {
        return undefined;
      }
      return {id: row.id, name: row.name, type: row.type};
    })
    .filter((entry): entry is EvaluatorOption => Boolean(entry));
};

export const promptCountLabel = (prompts: TracePromptRef[]): string => {
  const count = prompts.length;
  return count === 1 ? "1 prompt" : `${count} prompts`;
};

export const formatTokens = (usage?: TraceUsage): string => {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) {
    return "—";
  }
  return String((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
};

export const formatCost = (usage?: TraceUsage): string => {
  if (!usage || usage.costUsd === undefined) {
    return "—";
  }
  return `$${usage.costUsd.toFixed(4)}`;
};

export const formatLatency = (item: {endedAt?: string; startedAt: string}): string => {
  if (!item.endedAt) {
    return "—";
  }
  const start = DateTime.fromISO(item.startedAt, {zone: "utc"});
  const end = DateTime.fromISO(item.endedAt, {zone: "utc"});
  if (!start.isValid || !end.isValid) {
    return "—";
  }
  return `${Math.round(end.diff(start, "milliseconds").milliseconds)} ms`;
};

export const selectedSensitiveCount = (traces: TraceListItem[], selectedIds: string[]): number => {
  const selected = new Set(selectedIds);
  return traces.filter((trace) => selected.has(trace.id) && trace.sensitive).length;
};

export const flattenSpans = (spans: TraceSpanNode[], depth = 0): FlatSpan[] => {
  const rows: FlatSpan[] = [];
  for (const span of spans) {
    rows.push({depth, span});
    rows.push(...flattenSpans(span.children ?? [], depth + 1));
  }
  return rows;
};

export const durationBarPercent = (durationMs: number | undefined, maxMs: number): number => {
  if (!durationMs || maxMs <= 0) {
    return 0;
  }
  return Math.max(4, Math.round((durationMs / maxMs) * 100));
};

export const stringifyIo = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
