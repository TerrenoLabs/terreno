import type {AdminBreadcrumbSegment} from "../../../AdminBreadcrumbs";

export type ObservabilityActionFlags = Record<string, boolean>;

export type ObservabilityPermissionsPayload = Record<string, ObservabilityActionFlags>;

export interface ObservabilityStatusPayload {
  localOn: boolean;
  permissions?: ObservabilityPermissionsPayload;
  playgroundAi?: {
    source: "request-key" | "server" | "unavailable";
  };
  plugins: {capabilities: string[]; id: string}[];
  primaries: {
    datasets: string;
    experiments: string;
    prompts: string;
    reviewQueue: string;
  };
}

export interface AiObservabilityScreenMeta {
  leaf: string;
  section: string;
  title: string;
}

const AI_OBSERVABILITY_GROUP = "AI Observability";

export const AI_OBSERVABILITY_SCREENS: Record<string, AiObservabilityScreenMeta> = {
  "ai-dataset-detail": {leaf: "Detail", section: "Datasets", title: "Dataset"},
  "ai-datasets": {leaf: "List", section: "Datasets", title: "Datasets"},
  "ai-evaluator-detail": {leaf: "Detail", section: "Evaluators", title: "Evaluator"},
  "ai-evaluator-new": {leaf: "New", section: "Evaluators", title: "New evaluator"},
  "ai-evaluators": {leaf: "List", section: "Evaluators", title: "Evaluators"},
  "ai-experiment-new": {leaf: "New", section: "Experiments", title: "New experiment"},
  "ai-experiment-results": {leaf: "Results", section: "Experiments", title: "Experiment results"},
  "ai-experiments": {leaf: "List", section: "Experiments", title: "Experiments"},
  "ai-prompt-editor": {leaf: "Detail", section: "Prompts", title: "Prompt detail"},
  "ai-prompts": {leaf: "Library", section: "Prompts", title: "Prompts"},
  "ai-review": {leaf: "Queue", section: "Review", title: "Review queue"},
  "ai-review-item": {leaf: "Item", section: "Review", title: "Review item"},
  "ai-trace-detail": {leaf: "Detail", section: "Traces", title: "Trace"},
  "ai-traces": {leaf: "List", section: "Traces", title: "Traces"},
};

export const unwrapObservabilityStatus = (raw: unknown): ObservabilityStatusPayload | undefined => {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const nested = record.data;
  if (nested && typeof nested === "object" && "localOn" in nested) {
    return nested as ObservabilityStatusPayload;
  }
  if ("localOn" in record) {
    return record as unknown as ObservabilityStatusPayload;
  }
  return undefined;
};

export const formatObservabilityStatusChip = (status: ObservabilityStatusPayload): string => {
  const localLabel = status.localOn ? "Local on" : "Local off";
  return [
    localLabel,
    `prompts:${status.primaries.prompts}`,
    `datasets:${status.primaries.datasets}`,
    `experiments:${status.primaries.experiments}`,
  ].join(" · ");
};

const sectionHref = (section: string, routeBase: string): string => {
  const prefix = routeBase.endsWith("/") ? routeBase.slice(0, -1) : routeBase;
  if (section === "Prompts") {
    return `${prefix}/ai-prompts`;
  }
  if (section === "Traces") {
    return `${prefix}/ai-traces`;
  }
  if (section === "Evaluators") {
    return `${prefix}/ai-evaluators`;
  }
  if (section === "Datasets") {
    return `${prefix}/ai-datasets`;
  }
  if (section === "Experiments") {
    return `${prefix}/ai-experiments`;
  }
  return `${prefix}/ai-review`;
};

export const buildAiObservabilityBreadcrumbs = ({
  routeBase,
  screenName,
}: {
  routeBase: string;
  screenName: string;
}): AdminBreadcrumbSegment[] => {
  const meta = AI_OBSERVABILITY_SCREENS[screenName];
  const adminHref = routeBase || "/";
  if (!meta) {
    return [{href: adminHref, label: "Admin"}, {label: AI_OBSERVABILITY_GROUP}];
  }
  return [
    {href: adminHref, label: "Admin"},
    {label: AI_OBSERVABILITY_GROUP},
    {href: sectionHref(meta.section, routeBase), label: meta.section},
    {label: meta.leaf},
  ];
};
