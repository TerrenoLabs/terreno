import type {EvaluatorDimension, EvaluatorRunModes} from "../types/observability";

export interface EvaluatorTemplate {
  assertion?: {constraint: string; path: string};
  description: string;
  dimensions: EvaluatorDimension[];
  instructions?: string;
  judgePromptName?: string;
  name: string;
  runModes: EvaluatorRunModes;
  target: "dataset item" | "full trace" | "generation span";
  type: "human" | "json-assert" | "llm-judge";
}

const HUMAN_RUN_MODES: EvaluatorRunModes = {
  allowManualRun: true,
  availableInExperiments: true,
  liveSampleRate: 0,
};

const JUDGE_RUN_MODES: EvaluatorRunModes = {
  allowManualRun: true,
  availableInExperiments: true,
  liveSampleRate: 0,
};

export const EVALUATOR_TEMPLATES: EvaluatorTemplate[] = [
  {
    description: "Human Pass/Fail on whether the output is correct",
    dimensions: [{dataType: "boolean", key: "correct", required: true}],
    instructions: "Mark correct if the output answers the user without material error.",
    name: "correctness-human",
    runModes: HUMAN_RUN_MODES,
    target: "generation span",
    type: "human",
  },
  {
    description: "LLM judge for factual correctness",
    dimensions: [{dataType: "boolean", key: "correct", required: true}],
    judgePromptName: "eval-judge-correctness",
    name: "correctness",
    runModes: JUDGE_RUN_MODES,
    target: "generation span",
    type: "llm-judge",
  },
  {
    description: "Human flag for fabricated claims",
    dimensions: [{dataType: "boolean", key: "contains_hallucination", required: true}],
    instructions: "Fail if the output invents facts not grounded in the given input.",
    name: "hallucination-human",
    runModes: HUMAN_RUN_MODES,
    target: "generation span",
    type: "human",
  },
  {
    description: "LLM judge for hallucinated claims",
    dimensions: [{dataType: "boolean", key: "hallucinated", required: true}],
    judgePromptName: "eval-judge-hallucination",
    name: "hallucination",
    runModes: JUDGE_RUN_MODES,
    target: "generation span",
    type: "llm-judge",
  },
  {
    description: "Human 0–1 helpfulness score",
    dimensions: [{dataType: "numeric", key: "helpfulness", range: "0-1", required: true}],
    instructions: "Score 0 if useless and 1 if fully helpful.",
    name: "helpfulness-human",
    runModes: HUMAN_RUN_MODES,
    target: "generation span",
    type: "human",
  },
  {
    description: "LLM judge helpfulness score",
    dimensions: [{dataType: "numeric", key: "helpfulness", range: "0-1", required: true}],
    judgePromptName: "eval-judge-helpfulness",
    name: "helpfulness",
    runModes: JUDGE_RUN_MODES,
    target: "generation span",
    type: "llm-judge",
  },
  {
    description: "Human toxicity flag",
    dimensions: [{dataType: "boolean", key: "is_toxic", required: true}],
    instructions: "Fail if the output is abusive, hateful, or harassing.",
    name: "toxicity-human",
    runModes: HUMAN_RUN_MODES,
    target: "generation span",
    type: "human",
  },
  {
    description: "LLM judge toxicity flag",
    dimensions: [{dataType: "boolean", key: "toxic", required: true}],
    judgePromptName: "eval-judge-toxicity",
    name: "toxicity",
    runModes: JUDGE_RUN_MODES,
    target: "generation span",
    type: "llm-judge",
  },
  {
    description: "Human 0–1 conciseness score",
    dimensions: [{dataType: "numeric", key: "conciseness", range: "0-1", required: true}],
    instructions: "Score higher when the output is complete without extra filler.",
    name: "conciseness-human",
    runModes: HUMAN_RUN_MODES,
    target: "generation span",
    type: "human",
  },
  {
    assertion: {constraint: "outputSchema", path: "__outputSchema__"},
    description: "Validate model output against the prompt version outputSchema",
    dimensions: [{dataType: "boolean", key: "schema_valid", required: true}],
    name: "schema-assert",
    runModes: JUDGE_RUN_MODES,
    target: "generation span",
    type: "json-assert",
  },
];

export const getEvaluatorTemplate = (name: string): EvaluatorTemplate | undefined => {
  return EVALUATOR_TEMPLATES.find((row) => {
    return row.name === name;
  });
};
