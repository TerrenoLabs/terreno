/**
 * The one supported way to set up experiments, in four steps. Screens show the whole plan
 * (EvalPipelineOverview) and remind people which step they are on (EvalStepBanner).
 */
export type EvalPipelineStepNumber = 1 | 2 | 3 | 4;

export type ExperimentPipeline = "judge" | "prompt";

export interface EvalPipelineStep {
  number: EvalPipelineStepNumber;
  summary: string;
  title: string;
}

export const EVAL_PIPELINE_STEPS: EvalPipelineStep[] = [
  {
    number: 1,
    summary: "Collect real traces into a dataset. On Traces, choose Add to dataset.",
    title: "Build a dataset",
  },
  {
    number: 2,
    summary:
      "Pick a question set (usually yes/no questions) and send the dataset to human review. Reviewers answer each item once.",
    title: "Humans judge it",
  },
  {
    number: 3,
    summary:
      "Run 2–3 versions of an LLM judge prompt over the judged dataset. Keep the version whose answers are closest to the humans' and promote it.",
    title: "Calibrate the judge",
  },
  {
    number: 4,
    summary:
      "Compare product prompt versions on a dataset, scored by the calibrated judge, and promote the winner.",
    title: "Compare prompts",
  },
];

export const JUDGE_ONCE_NOTE =
  "Humans judge a dataset once. After that, every judge experiment reuses their answers — run 10 if you like — as long as the questions stay the same. Change a question and the old answers go stale and need judging again.";

export const PIPELINE_STEP: Record<ExperimentPipeline, EvalPipelineStepNumber> = {
  judge: 3,
  prompt: 4,
};

export const PIPELINE_ACTIVITY: Record<ExperimentPipeline, string> = {
  judge: "Calibrating a judge",
  prompt: "Comparing prompt versions",
};

export const HUMAN_JUDGING_ACTIVITY = "Humans judge the dataset";

/** Reminder line such as "Step 3 of 4 · Calibrating a judge — pick a dataset humans judged." */
export const formatStepReminder = ({
  activity,
  detail,
  step,
}: {
  activity: string;
  detail: string;
  step: EvalPipelineStepNumber;
}): string => {
  return `Step ${step} of ${EVAL_PIPELINE_STEPS.length} · ${activity} — ${detail}`;
};

export const parsePipeline = (value: unknown): ExperimentPipeline | undefined => {
  if (value === "judge" || value === "prompt") {
    return value;
  }
  return undefined;
};
