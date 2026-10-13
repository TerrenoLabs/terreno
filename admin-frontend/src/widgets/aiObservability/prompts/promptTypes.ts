export interface PromptUsage7d {
  calls: number;
  costUsd?: number;
  lastUsed?: string;
}

export interface PromptListItem {
  folder: string;
  latestVersion: number;
  name: string;
  production: number | "—";
  type: "chat" | "text";
  usage7d?: PromptUsage7d;
}

export interface PromptVariable {
  key: string;
  label?: string;
  required: boolean;
  reviewerNote?: string;
}

export interface PromptRelatedExperimentSummary {
  created: string;
  id: string;
  name: string;
  promptName: string;
  status: "completed" | "failed" | "pending" | "running";
  versions: number[];
}

export interface PromptRelatedTraceSummary {
  id: string;
  name: string;
  promptName: string;
  promptVersion: number;
  sensitive: boolean;
  startedAt: string;
  status: "error" | "ok";
}

export interface PromptRelationships {
  experiments: {
    items: PromptRelatedExperimentSummary[];
    limit: number;
    total: number;
  };
  traces: {
    items: PromptRelatedTraceSummary[];
    limit: number;
    total: number;
  };
}

export interface PromptVersionDetail {
  config?: Record<string, unknown>;
  created?: string;
  inputSchema?: Record<string, unknown>;
  outputFieldNotes?: Record<string, string>;
  outputSchema?: Record<string, unknown>;
  sensitive: boolean;
  system?: string;
  template?: string;
  type: "chat" | "text";
  variables: PromptVariable[];
  version: number;
}

export interface PromptDetail {
  description?: string;
  folder: string;
  labels: Array<{label: string; version: number}>;
  name: string;
  relationships: PromptRelationships;
  tags: string[];
  versions: PromptVersionDetail[];
}

const emptyRelationships = (): PromptRelationships => ({
  experiments: {items: [], limit: 20, total: 0},
  traces: {items: [], limit: 20, total: 0},
});

const normalizePromptDetail = (detail: PromptDetail): PromptDetail => {
  return {
    ...detail,
    relationships: detail.relationships ?? emptyRelationships(),
  };
};

export interface PlaygroundRunResult {
  compiledMessages: Array<{content: string; role: "system" | "user"}>;
  costUsd?: number;
  latencyMs: number;
  output: string;
  tokens: {inputTokens?: number; outputTokens?: number; totalTokens?: number};
}

export interface FolderCount {
  count: number;
  folder: string;
}

export const ALL_FOLDERS = "";

export const TEMPERATURE_PRESETS: Array<{label: string; value: string}> = [
  {label: "Deterministic (0)", value: "0"},
  {label: "Low (0.3)", value: "0.3"},
  {label: "Balanced (0.7)", value: "0.7"},
  {label: "Default (1)", value: "1"},
  {label: "High (1.5)", value: "1.5"},
  {label: "Maximum (2)", value: "2"},
];

export const unwrapPromptPayload = <T>(raw: unknown): T | undefined => {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "object" && "data" in raw) {
    return (raw as {data: T}).data;
  }
  return raw as T;
};

export const unwrapPromptList = (raw: unknown): PromptListItem[] => {
  const payload = unwrapPromptPayload<PromptListItem[] | {data: PromptListItem[]}>(raw);
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
};

export const unwrapPromptDetail = (raw: unknown): PromptDetail | undefined => {
  const payload = unwrapPromptPayload<PromptDetail>(raw);
  if (!payload || typeof payload !== "object" || !("name" in payload)) {
    return undefined;
  }
  return normalizePromptDetail(payload);
};

export const folderCounts = (prompts: PromptListItem[]): FolderCount[] => {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    counts.set(prompt.folder, (counts.get(prompt.folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => {
      return a.localeCompare(b);
    })
    .map(([folder, count]) => ({count, folder}));
};

export const formatProduction = (production: number | "—"): string => {
  if (production === "—") {
    return "—";
  }
  return `v${production}`;
};

export const formatUsageCalls = (usage?: PromptUsage7d): string => {
  if (!usage) {
    return "—";
  }
  return String(usage.calls);
};

export const formatUsageCost = (usage?: PromptUsage7d): string => {
  if (!usage || usage.costUsd === undefined) {
    return "—";
  }
  return `$${usage.costUsd.toFixed(4)}`;
};

export const formatLastUsed = (usage?: PromptUsage7d): string => {
  if (!usage?.lastUsed) {
    return "—";
  }
  return usage.lastUsed;
};

export const filterPrompts = ({
  folder,
  prompts,
  search,
}: {
  folder: string;
  prompts: PromptListItem[];
  search: string;
}): PromptListItem[] => {
  const needle = search.trim().toLowerCase();
  return prompts.filter((prompt) => {
    if (folder && prompt.folder !== folder) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      prompt.name.toLowerCase().includes(needle) || prompt.folder.toLowerCase().includes(needle)
    );
  });
};

export const latestVersionFromDetail = (detail: PromptDetail): number => {
  return Math.max(0, ...detail.versions.map((entry) => entry.version));
};

export const nextVersionFromDetail = (detail: PromptDetail): number => {
  return latestVersionFromDetail(detail) + 1;
};

export const productionVersionFromDetail = (detail: PromptDetail): number | undefined => {
  return detail.labels.find((entry) => entry.label === "production")?.version;
};

export const judgeOutputSchemaFromDetail = (
  detail: PromptDetail
): Record<string, unknown> | undefined => {
  const versionNumber = productionVersionFromDetail(detail) ?? latestVersionFromDetail(detail);
  return detail.versions.find((entry) => entry.version === versionNumber)?.outputSchema;
};

export const templateVariableKeys = (template: string): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const key = match[1];
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
};

export const variablesFromKeys = (keys: string[]): PromptVariable[] => {
  return keys.map((key) => ({key, required: true}));
};

export const variableNamesFromVersion = (version: PromptVersionDetail): string[] => {
  if (version.variables.length > 0) {
    return version.variables.map((entry) => entry.key);
  }
  return templateVariableKeys(version.template ?? "");
};

export const schemaSummary = (version: PromptVersionDetail): string => {
  const variableKeys = version.variables.map((entry) => entry.key);
  const input = variableKeys.length > 0 ? variableKeys.join(", ") : "none";
  const outputKeys = version.outputSchema ? Object.keys(version.outputSchema) : [];
  const output = outputKeys.length > 0 ? outputKeys.join(", ") : "none";
  return `Variables: ${input}. Output: ${output}.`;
};

export const outgoingProductionCopy = ({
  detail,
  selectedVersion,
}: {
  detail: PromptDetail;
  selectedVersion: number;
}): string => {
  const productionVersion = productionVersionFromDetail(detail);
  const outgoingLabel =
    productionVersion !== undefined ? `v${productionVersion}` : "none (no production label yet)";
  return `${detail.name} v${selectedVersion} will become production. The outgoing production version is ${outgoingLabel}.`;
};

export const formatPlaygroundMetrics = (result: PlaygroundRunResult): string => {
  const tokens = result.tokens.totalTokens;
  const tokenPart =
    tokens === undefined
      ? result.tokens.inputTokens !== undefined || result.tokens.outputTokens !== undefined
        ? `${result.tokens.inputTokens ?? 0}+${result.tokens.outputTokens ?? 0} tokens`
        : undefined
      : `${tokens} tokens`;
  const costPart = result.costUsd !== undefined ? `$${result.costUsd.toFixed(4)}` : undefined;
  return [`${result.latencyMs} ms`, tokenPart, costPart].filter(Boolean).join(" · ");
};
