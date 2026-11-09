export interface EvaluatorDimension {
  dataType: "boolean" | "categorical" | "numeric";
  key: string;
  /** Question shown to human reviewers in place of the score key. */
  question?: string;
  range?: string;
  required: boolean;
}

export interface EvaluatorRunModes {
  allowManualRun: boolean;
  availableInExperiments: boolean;
  liveSampleRate: number;
}

/** How well an llm-judge agreed with human answers in its latest judge calibration experiment. */
export interface EvaluatorCalibration {
  datasetName?: string;
  experimentId: string;
  experimentName: string;
  passed: boolean;
  questionSetName?: string;
  /** Agreement rate (0–1) of `version`; unset when nothing could be compared. */
  rate?: number;
  /** True when the question set's questions changed after the experiment ran. */
  stale: boolean;
  targetAgreement?: number;
  /** The judge prompt's production version when it was compared, else the best version. */
  version: number;
}

export interface EvaluatorRecord {
  assertion?: {constraint: string; path: string};
  /** llm-judge only: the latest judge calibration against human answers. */
  calibration?: EvaluatorCalibration;
  confidenceAlertBelow: number;
  description?: string;
  dimensions: EvaluatorDimension[];
  id: string;
  instructions?: string;
  judgePromptName?: string;
  name: string;
  runModes: EvaluatorRunModes;
  target: "dataset item" | "full trace" | "generation span";
  type: "human" | "json-assert" | "llm-judge";
}

export interface EvaluatorUsageRow {
  costUsd?: number;
  experimentId: string;
  experimentName: string;
  runs: number;
}

export const EVALUATOR_TYPE_LABELS: Record<EvaluatorRecord["type"], string> = {
  human: "Human",
  "json-assert": "JSON assert",
  "llm-judge": "LLM judge",
};

export const DIMENSION_DATA_TYPES: EvaluatorDimension["dataType"][] = [
  "boolean",
  "numeric",
  "categorical",
];

export const emptyDimension = (): EvaluatorDimension => {
  return {
    dataType: "boolean",
    key: "",
    required: true,
  };
};

const NUMERIC_RANGE_PATTERN = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/;

export const parseNumericBounds = (range?: string): {max: string; min: string} => {
  const matches = range?.match(NUMERIC_RANGE_PATTERN);
  if (!matches) {
    return {max: "1", min: "0"};
  }
  return {max: matches[2] ?? "1", min: matches[1] ?? "0"};
};

export const formatNumericRange = (min: string, max: string): string => {
  return `${min.trim()}-${max.trim()}`;
};

export const isCompleteNumericRange = (range?: string): boolean => {
  const matches = range?.match(NUMERIC_RANGE_PATTERN);
  if (!matches?.[1] || !matches[2]) {
    return false;
  }
  return Number(matches[1]) <= Number(matches[2]);
};

export const parseCategories = (range?: string): string[] => {
  if (!range || NUMERIC_RANGE_PATTERN.test(range)) {
    return [];
  }
  return range
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const formatCategories = (categories: string[]): string | undefined => {
  const cleaned = categories.map((entry) => entry.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.join("|");
};

export const dimensionForDataType = (
  dimension: EvaluatorDimension,
  dataType: EvaluatorDimension["dataType"]
): EvaluatorDimension => {
  if (dataType === "boolean") {
    return {
      dataType,
      key: dimension.key,
      ...(dimension.question ? {question: dimension.question} : {}),
      required: dimension.required,
    };
  }
  if (dataType === "numeric") {
    return {
      ...dimension,
      dataType,
      range: isCompleteNumericRange(dimension.range)
        ? dimension.range
        : formatNumericRange("0", "1"),
    };
  }
  return {
    ...dimension,
    dataType,
    range: formatCategories(parseCategories(dimension.range)),
  };
};

const unwrapObservabilityPayload = <T>(raw: unknown): T | undefined => {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "object" && "data" in raw) {
    return (raw as {data: T}).data;
  }
  return raw as T;
};

export const unwrapEvaluatorList = (raw: unknown): EvaluatorRecord[] => {
  const payload = unwrapObservabilityPayload<EvaluatorRecord[]>(raw);
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.filter((entry): entry is EvaluatorRecord => {
    return Boolean(entry && typeof entry.id === "string" && typeof entry.name === "string");
  });
};

export const unwrapEvaluatorRecord = (raw: unknown): EvaluatorRecord | undefined => {
  const payload = unwrapObservabilityPayload<EvaluatorRecord>(raw);
  if (!payload || typeof payload.id !== "string") {
    return undefined;
  }
  return payload;
};

export const formatDimensionSummary = (dimensions: EvaluatorDimension[]): string => {
  if (dimensions.length === 0) {
    return "—";
  }
  return dimensions.map((dimension) => dimension.key).join(", ");
};

export const formatRunModeChips = (runModes: EvaluatorRunModes): string[] => {
  const chips: string[] = [];
  if (runModes.allowManualRun) {
    chips.push("Manual");
  }
  if (runModes.availableInExperiments) {
    chips.push("Experiments");
  }
  if (runModes.liveSampleRate > 0) {
    chips.push(`Live ${Math.round(runModes.liveSampleRate)}%`);
  }
  return chips;
};

export const judgeSchemaMissingDimensions = (
  dimensions: EvaluatorDimension[],
  outputSchema?: Record<string, unknown>
): string[] => {
  const properties =
    outputSchema && typeof outputSchema.properties === "object"
      ? (outputSchema.properties as Record<string, unknown>)
      : {};
  return dimensions
    .filter((dimension) => {
      return dimension.required && properties[dimension.key] === undefined;
    })
    .map((dimension) => dimension.key);
};

export const parseApiErrorTitle = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const record = error as {data?: {title?: string}; message?: string};
  if (record.data?.title) {
    return record.data.title;
  }
  if (record.message) {
    return record.message;
  }
  return undefined;
};

export interface CalibrationSummary {
  /** True when the judge passed its latest calibration and the questions have not changed. */
  isTrusted: boolean;
  label: string;
  status: "neutral" | "success" | "warning";
}

const percent = (rate?: number): string => {
  if (rate === undefined || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 1000) / 10}%`;
};

/**
 * One-line calibration status for an llm-judge, such as
 * "Calibrated: 95% agreement on summary-review-set (v2)".
 */
export const summarizeCalibration = (calibration?: EvaluatorCalibration): CalibrationSummary => {
  if (!calibration) {
    return {
      isTrusted: false,
      label: "Not calibrated — run a judge calibration (step 3) first",
      status: "neutral",
    };
  }
  const where = calibration.datasetName ? ` on ${calibration.datasetName}` : "";
  const rate = percent(calibration.rate);
  if (calibration.stale) {
    return {
      isTrusted: false,
      label: `Calibration stale: the questions changed after ${calibration.experimentName} — re-judge and recalibrate`,
      status: "warning",
    };
  }
  if (!calibration.passed) {
    const target = percent(calibration.targetAgreement ?? 0.9);
    return {
      isTrusted: false,
      label: `Below target: ${rate} agreement${where} (v${calibration.version}, needs ${target})`,
      status: "warning",
    };
  }
  return {
    isTrusted: true,
    label: `Calibrated: ${rate} agreement${where} (v${calibration.version})`,
    status: "success",
  };
};

/** Question keys the judge and the question set both answer. */
export const sharedQuestionKeys = (
  judge: Pick<EvaluatorRecord, "dimensions">,
  questionSet: Pick<EvaluatorRecord, "dimensions">
): string[] => {
  const judgeKeys = new Set(judge.dimensions.map((dimension) => dimension.key));
  return questionSet.dimensions
    .map((dimension) => dimension.key)
    .filter((key) => judgeKeys.has(key));
};
