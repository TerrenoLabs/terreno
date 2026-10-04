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

export interface TraceListFilters {
  flaggedForDataset?: boolean;
  from: string;
  hasScore?: boolean;
  prompt: string;
  sensitive?: boolean;
  sessionId: string;
  status: "" | "error" | "ok";
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

export const emptyTraceFilters = (): TraceListFilters => ({
  from: "",
  prompt: "",
  sessionId: "",
  status: "",
  to: "",
  userId: "",
});

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
