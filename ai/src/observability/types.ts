import {type AnyTerrenoAccess, APIError, logger} from "@terreno/api";

export type ObservabilityCapability =
  | "datasets"
  | "experiments"
  | "prompts"
  | "reviewQueue"
  | "scores"
  | "traces";

export type ControlPrimary = "langfuse" | "local";

export interface ObservabilityControlConfig {
  datasets: ControlPrimary;
  experiments: ControlPrimary;
  prompts: ControlPrimary;
  reviewQueue: "local";
}

export type SpanKind = "AGENT" | "CHAIN" | "EVALUATOR" | "LLM" | "RETRIEVER" | "TOOL";

export interface SpanRecord {
  durationMs?: number;
  endedAt?: string;
  error?: string;
  id: string;
  input?: unknown;
  kind: SpanKind;
  name: string;
  output?: unknown;
  parentSpanId?: string;
  sensitive?: boolean;
  startOffsetMs?: number;
  startedAt: string;
  status: "error" | "ok";
  usage?: {
    costUsd?: number;
    inputTokens?: number;
    model?: string;
    outputTokens?: number;
  };
}

export interface TraceRecord {
  endedAt?: string;
  errorSummary?: string;
  flaggedForDataset?: boolean;
  id: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  name: string;
  output?: unknown;
  prompts: {label?: string; name: string; version: number}[];
  sensitive: boolean;
  sessionId?: string;
  spans: SpanRecord[];
  startedAt: string;
  status: "error" | "ok";
  usage?: {
    costUsd?: number;
    inputTokens?: number;
    model?: string;
    outputTokens?: number;
  };
  userId?: string;
}

export interface ScoreRecord {
  comment?: string;
  confidence?: number;
  dataType: "boolean" | "categorical" | "numeric";
  evaluatorId?: string;
  name: string;
  source: "code" | "human" | "llm-judge" | "user-feedback";
  spanId?: string;
  traceId: string;
  value: boolean | number | string;
}

export interface PromptVersionRef {
  body: string;
  label?: string;
  name: string;
  sensitive?: boolean;
  version: number;
}

export interface PromptRegistry {
  get: (args: {label?: string; name: string}) => Promise<PromptVersionRef | undefined>;
}

export interface TraceExportResult {
  id?: string;
}

export interface TraceSink {
  export: (trace: TraceRecord) => Promise<TraceExportResult | undefined>;
}

export interface ScoreSink {
  export: (score: ScoreRecord) => Promise<void>;
}

export interface DatasetStore {
  id?: string;
}

export interface ExperimentRunner {
  id?: string;
}

export interface ReviewQueue {
  id?: string;
}

export interface ObservabilityPlugin {
  readonly capabilities: ReadonlySet<ObservabilityCapability>;
  readonly id: string;
  datasetStore?: DatasetStore | import("./local/datasetStore").LocalDatasetStore;
  experimentRunner?: ExperimentRunner | import("./local/experimentRunner").LocalExperimentRunner;
  promptRegistry?: PromptRegistry;
  reviewQueue?: ReviewQueue;
  scoreSink?: ScoreSink;
  traceSink?: TraceSink;
}

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface ObservabilityGenerateClient {
  readonly modelId: string;
  generateJsonObject: <OBJECT>(options: {
    prompt: string;
    promptName?: string;
    schema: import("ai").FlexibleSchema<OBJECT>;
    schemaDescription?: string;
    schemaName?: string;
    skipTrace?: boolean;
    systemPrompt?: string;
    temperature?: number;
    userId?: import("mongoose").Types.ObjectId;
  }) => Promise<OBJECT>;
  generateText: (options: {
    prompt: string;
    skipTrace?: boolean;
    systemPrompt?: string;
    temperature?: number;
    userId?: import("mongoose").Types.ObjectId;
  }) => Promise<string>;
}

/** Selects an AI client for a specific model id (used by experiment `modelOverride`). */
export type ObservabilityAiServiceFactory = (
  modelId: string
) => ObservabilityGenerateClient | undefined;

export type ObservabilityRequestAiServiceFactory = (params: {
  apiKey?: string;
  modelId?: string;
}) => ObservabilityGenerateClient | undefined;

export interface ObservabilityAppOptions {
  accessControl?: AnyTerrenoAccess;
  aiService?: ObservabilityGenerateClient;
  aiServiceFactory?: ObservabilityAiServiceFactory;
  control?: {
    datasets?: ControlPrimary;
    experiments?: ControlPrimary;
    prompts?: ControlPrimary;
    reviewQueue?: ControlPrimary;
  };
  plugins: ObservabilityPlugin[];
  priceMap?: Record<string, ModelPrice>;
  requestAiServiceFactory?: ObservabilityRequestAiServiceFactory;
  sampleRate?: number;
}

const CONTROL_CAPABILITY: Record<
  "datasets" | "experiments" | "prompts" | "reviewQueue",
  ObservabilityCapability
> = {
  datasets: "datasets",
  experiments: "experiments",
  prompts: "prompts",
  reviewQueue: "reviewQueue",
};

const CONTROL_STORE: Record<
  "datasets" | "experiments" | "prompts" | "reviewQueue",
  keyof ObservabilityPlugin
> = {
  datasets: "datasetStore",
  experiments: "experimentRunner",
  prompts: "promptRegistry",
  reviewQueue: "reviewQueue",
};

export const DEFAULT_OBSERVABILITY_CONTROL: ObservabilityControlConfig = {
  datasets: "local",
  experiments: "local",
  prompts: "local",
  reviewQueue: "local",
};

export const resolveObservabilityControl = (
  options: ObservabilityAppOptions
): ObservabilityControlConfig => {
  return {
    datasets: options.control?.datasets ?? DEFAULT_OBSERVABILITY_CONTROL.datasets,
    experiments: options.control?.experiments ?? DEFAULT_OBSERVABILITY_CONTROL.experiments,
    prompts: options.control?.prompts ?? DEFAULT_OBSERVABILITY_CONTROL.prompts,
    reviewQueue: "local",
  };
};

export const validateObservabilityConfig = (
  options: ObservabilityAppOptions
): ObservabilityControlConfig => {
  const fail = (message: string): never => {
    logger.error(message);
    throw new APIError({status: 500, title: message});
  };

  if (options.control?.reviewQueue && options.control.reviewQueue !== "local") {
    return fail("Observability reviewQueue.primary must be local");
  }

  const datasetsPrimary = options.control?.datasets ?? DEFAULT_OBSERVABILITY_CONTROL.datasets;
  const experimentsPrimary =
    options.control?.experiments ?? DEFAULT_OBSERVABILITY_CONTROL.experiments;
  if (experimentsPrimary !== datasetsPrimary) {
    return fail("Observability experiments.primary must equal datasets.primary");
  }

  const control = resolveObservabilityControl(options);
  const primaries: Array<"datasets" | "experiments" | "prompts" | "reviewQueue"> = [
    "prompts",
    "datasets",
    "experiments",
    "reviewQueue",
  ];

  for (const key of primaries) {
    const primaryId = control[key];
    const capability = CONTROL_CAPABILITY[key];
    const storeKey = CONTROL_STORE[key];
    const plugin = options.plugins.find((candidate) => {
      return (
        candidate.id === primaryId &&
        candidate.capabilities.has(capability) &&
        candidate[storeKey] !== undefined
      );
    });
    if (!plugin) {
      return fail(`Observability ${key} primary "${primaryId}" has no plugin`);
    }
  }

  return control;
};
