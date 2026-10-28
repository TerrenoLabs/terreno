export interface DatasetCounts {
  auto: number;
  human: number;
  needsReview: number;
  total: number;
}

export interface DatasetRecord {
  counts: DatasetCounts;
  created: string;
  description?: string;
  expectedOutputSchema?: Record<string, unknown>;
  id: string;
  inputSchemaPromptName?: string;
  name: string;
  tags: string[];
  updated: string;
}

export interface DatasetItemRecord {
  annotatedBy?: {label: string; reviewItemId?: string; userId?: string};
  created: string;
  datasetId: string;
  expectedOutput?: unknown;
  id: string;
  input: unknown;
  metadata?: Record<string, unknown>;
  origin: "manual" | "synthetic" | "trace";
  outcomeClass?: "fn" | "fp" | "tn" | "tp";
  proofread: boolean;
  sourceTraceId?: string;
  tags: string[];
  updated: string;
}

export interface DatasetImportResult {
  created: number;
  errors: Array<{message: string; path?: string; row: number}>;
}

export type DatasetItemTab = "all" | "auto" | "human" | "needsReview";

const unwrapObservabilityPayload = <T>(raw: unknown): T | undefined => {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "object" && "data" in raw) {
    return (raw as {data: T}).data;
  }
  return raw as T;
};

export const unwrapDatasetList = (raw: unknown): DatasetRecord[] => {
  const payload = unwrapObservabilityPayload<DatasetRecord[]>(raw);
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.filter((entry): entry is DatasetRecord => {
    return Boolean(entry && typeof entry.id === "string");
  });
};

export const unwrapDatasetRecord = (raw: unknown): DatasetRecord | undefined => {
  const payload = unwrapObservabilityPayload<DatasetRecord>(raw);
  if (!payload || typeof payload.id !== "string") {
    return undefined;
  }
  return payload;
};

export const unwrapDatasetItems = (raw: unknown): DatasetItemRecord[] => {
  const payload = unwrapObservabilityPayload<DatasetItemRecord[]>(raw);
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.filter((entry): entry is DatasetItemRecord => {
    return Boolean(entry && typeof entry.id === "string");
  });
};

export const formatProvenanceBar = (counts: DatasetCounts): string => {
  if (counts.total === 0) {
    return "—";
  }
  const humanPct = Math.round((counts.human / counts.total) * 100);
  // Auto is the unreviewed trace/synthetic share. A stale payload that also
  // counts those items as human must not render both shares at 100%.
  const nonHuman = Math.max(0, counts.total - counts.human);
  const autoCount = Math.min(Math.max(0, counts.auto), nonHuman);
  const autoPct = Math.round((autoCount / counts.total) * 100);
  return `${humanPct}% human · ${autoPct}% auto`;
};

export const filterDatasetItemsByTab = (
  items: DatasetItemRecord[],
  tab: DatasetItemTab
): DatasetItemRecord[] => {
  if (tab === "all") {
    return items;
  }
  if (tab === "needsReview") {
    return items.filter((item) => !item.proofread);
  }
  if (tab === "human") {
    return items.filter((item) => item.proofread);
  }
  return items.filter((item) => {
    return !item.proofread && (item.origin === "trace" || item.origin === "synthetic");
  });
};

export const summarizeJson = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  if (typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};
