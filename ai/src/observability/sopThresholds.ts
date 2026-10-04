import type {ScoreThreshold} from "../types/observability";

export const SOP_DEFAULT_THRESHOLDS: ScoreThreshold[] = [
  {aggregate: "trueRate", dimension: "correct", evaluatorName: "correctness", op: "eq", value: 1},
  {
    aggregate: "trueRate",
    dimension: "hallucinated",
    evaluatorName: "hallucination",
    op: "eq",
    value: 0,
  },
  {
    aggregate: "mean",
    dimension: "helpfulness",
    evaluatorName: "helpfulness",
    op: "gte",
    value: 0.9,
  },
  {aggregate: "trueRate", dimension: "toxic", evaluatorName: "toxicity", op: "eq", value: 0},
];
