import type {FlexibleSchema} from "ai";
import {jsonSchema} from "ai";

import type {EvaluatorDimension} from "../types/observability";
import {getValueAtPath} from "./jsonPath";
import {validateAgainstSchema} from "./schemaValidation";
import type {ObservabilityGenerateClient} from "./types";

export type EvaluatorAiClient = Pick<ObservabilityGenerateClient, "generateJsonObject">;

export interface EvaluatorExecutionContext {
  evaluator: {
    assertion?: {constraint: string; path: string};
    dimensions: EvaluatorDimension[];
    judgePromptName?: string;
    name: string;
    type: "human" | "json-assert" | "llm-judge";
  };
  expectedOutput?: unknown;
  input: unknown;
  output: unknown;
  outputSchema?: Record<string, unknown>;
}

export interface EvaluatorExecutionResult {
  confidence?: number;
  error?: string;
  scores?: Record<string, boolean | number | string>;
}

const parseConstraintValue = (constraint: string): unknown => {
  const raw = constraint.slice("eq:".length).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const evaluatePathConstraint = (value: unknown, constraint: string): boolean => {
  if (constraint === "exists") {
    return value !== undefined && value !== null;
  }
  if (constraint === "notEmpty") {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  }
  if (constraint.startsWith("type:")) {
    const expected = constraint.slice("type:".length);
    if (expected === "array") {
      return Array.isArray(value);
    }
    return typeof value === expected;
  }
  if (constraint.startsWith("eq:")) {
    return value === parseConstraintValue(constraint);
  }
  if (constraint.startsWith("gte:")) {
    return Number(value) >= Number(constraint.slice("gte:".length));
  }
  if (constraint.startsWith("lte:")) {
    return Number(value) <= Number(constraint.slice("lte:".length));
  }
  return false;
};

const coerceDimensionValue = (
  dimension: EvaluatorDimension,
  raw: unknown
): boolean | number | string | undefined => {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (dimension.dataType === "boolean") {
    if (typeof raw === "boolean") {
      return raw;
    }
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    return Boolean(raw);
  }
  if (dimension.dataType === "numeric") {
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return parsed;
  }
  return String(raw);
};

const buildJudgePrompt = (context: EvaluatorExecutionContext): string => {
  return [
    "Evaluate the model output for the dataset item.",
    "",
    `Input JSON:\n${JSON.stringify(context.input, null, 2)}`,
    "",
    `Model output JSON:\n${JSON.stringify(context.output, null, 2)}`,
    context.expectedOutput !== undefined
      ? `\nExpected output JSON:\n${JSON.stringify(context.expectedOutput, null, 2)}`
      : "",
  ].join("\n");
};

const extractDeclaredScores = (
  dimensions: EvaluatorDimension[],
  payload: Record<string, unknown>
): Record<string, boolean | number | string> => {
  const scores: Record<string, boolean | number | string> = {};
  for (const dimension of dimensions) {
    const coerced = coerceDimensionValue(dimension, payload[dimension.key]);
    if (coerced !== undefined) {
      scores[dimension.key] = coerced;
    }
  }
  return scores;
};

export const runJsonAssertEvaluator = (
  context: EvaluatorExecutionContext
): EvaluatorExecutionResult => {
  const dimension = context.evaluator.dimensions[0];
  if (!dimension) {
    return {error: "json-assert evaluator requires at least one dimension"};
  }

  const usesOutputSchema =
    !context.evaluator.assertion?.path ||
    context.evaluator.assertion.path === "__outputSchema__" ||
    context.evaluator.name === "schema-assert";

  if (usesOutputSchema) {
    const errors = validateAgainstSchema(context.outputSchema, context.output);
    const valid = errors.length === 0;
    return {
      scores: {
        [dimension.key]: valid,
      },
      ...(valid
        ? {}
        : {
            error: errors.map((row) => `${row.path}: ${row.message}`).join("; "),
          }),
    };
  }

  const actual = getValueAtPath(context.output, context.evaluator.assertion?.path ?? "");
  const passed = evaluatePathConstraint(actual, context.evaluator.assertion?.constraint ?? "");
  return {
    scores: {
      [dimension.key]: passed,
    },
    ...(passed
      ? {}
      : {
          error: `Assertion failed at ${context.evaluator.assertion?.path}`,
        }),
  };
};

export const runLlmJudgeEvaluator = async (
  context: EvaluatorExecutionContext,
  ai: EvaluatorAiClient,
  judgeOutputSchema: Record<string, unknown>
): Promise<EvaluatorExecutionResult> => {
  const judgePromptName = context.evaluator.judgePromptName;
  if (!judgePromptName) {
    return {error: "llm-judge evaluator is missing judgePromptName"};
  }

  try {
    const payload = (await ai.generateJsonObject({
      prompt: buildJudgePrompt(context),
      promptName: judgePromptName,
      schema: jsonSchema(judgeOutputSchema) as FlexibleSchema<Record<string, unknown>>,
      schemaName: `${context.evaluator.name}-judge`,
      skipTrace: true,
    })) as Record<string, unknown>;

    const scores = extractDeclaredScores(context.evaluator.dimensions, payload);
    const confidenceRaw = payload.confidence;
    const confidence =
      typeof confidenceRaw === "number"
        ? confidenceRaw
        : confidenceRaw !== undefined
          ? Number(confidenceRaw)
          : undefined;

    const missing = context.evaluator.dimensions
      .filter((dimension) => {
        return dimension.required && scores[dimension.key] === undefined;
      })
      .map((dimension) => dimension.key);
    if (missing.length > 0) {
      return {
        confidence: Number.isNaN(confidence) ? undefined : confidence,
        error: `Judge output missing required dimensions: ${missing.join(", ")}`,
        scores,
      };
    }

    return {
      confidence: Number.isNaN(confidence) ? undefined : confidence,
      scores,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "llm-judge generation failed",
    };
  }
};

export const runEvaluator = async (
  context: EvaluatorExecutionContext,
  deps: {ai?: EvaluatorAiClient; judgeOutputSchema?: Record<string, unknown>}
): Promise<EvaluatorExecutionResult> => {
  if (context.evaluator.type === "human") {
    return {error: "human evaluators are not executed automatically"};
  }
  if (context.evaluator.type === "json-assert") {
    return runJsonAssertEvaluator(context);
  }
  if (!deps.ai || !deps.judgeOutputSchema) {
    return {error: "llm-judge execution requires an AI client and judge output schema"};
  }
  return runLlmJudgeEvaluator(context, deps.ai, deps.judgeOutputSchema);
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
