import type {ObsPromptVariable} from "../types/observability";

export interface ReviewPanelField {
  key: string;
  label: string;
  note?: string;
  value: unknown;
}

export interface ReviewPanels {
  given: ReviewPanelField[];
  wrote: ReviewPanelField[];
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {value};
};

export const buildReviewPanels = (params: {
  input?: unknown;
  output?: unknown;
  outputFieldNotes?: Record<string, string>;
  outputSchema?: Record<string, unknown>;
  variables?: ObsPromptVariable[];
}): ReviewPanels => {
  const input = asRecord(params.input);
  const output = asRecord(params.output);
  const given: ReviewPanelField[] = [];
  if (params.variables && params.variables.length > 0) {
    for (const variable of params.variables) {
      given.push({
        key: variable.key,
        label: variable.label ?? variable.key,
        note: variable.reviewerNote,
        value: input[variable.key] ?? input.value,
      });
    }
  } else {
    for (const [key, value] of Object.entries(input)) {
      given.push({key, label: key, value});
    }
  }

  const wrote: ReviewPanelField[] = [];
  const schemaProps =
    params.outputSchema &&
    typeof params.outputSchema.properties === "object" &&
    params.outputSchema.properties
      ? (params.outputSchema.properties as Record<string, unknown>)
      : undefined;
  const keys = schemaProps ? Object.keys(schemaProps) : Object.keys(output);
  for (const key of keys) {
    wrote.push({
      key,
      label: key,
      note: params.outputFieldNotes?.[key],
      value: output[key] ?? output.value,
    });
  }
  return {given, wrote};
};
