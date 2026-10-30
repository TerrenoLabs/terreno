import {beforeEach, describe, expect, it, mock} from "bun:test";
import {fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import type {DatasetRecord} from "../datasets/datasetTypes";
import type {EvaluatorRecord} from "../evaluators/evaluatorTypes";
import type {PromptDetail} from "../prompts/promptTypes";
import {AiJudgeExperimentSteps, judgesForQuestionSet} from "./AiJudgeExperimentSteps";

const runModes = {
  allowManualRun: true,
  availableInExperiments: true,
  liveSampleRate: 0,
};

const human: EvaluatorRecord = {
  confidenceAlertBelow: 0.5,
  dimensions: [
    {dataType: "boolean", key: "correct", required: true},
    {dataType: "categorical", key: "tone", range: "safe|unsafe", required: true},
  ],
  id: "eval-human",
  name: "review queue",
  runModes,
  target: "full trace",
  type: "human",
};

const partialJudge: EvaluatorRecord = {
  calibration: {
    datasetName: "gold",
    experimentId: "exp-old",
    experimentName: "old",
    passed: false,
    rate: 0.4,
    stale: true,
  },
  confidenceAlertBelow: 0.5,
  dimensions: [{dataType: "boolean", key: "correct", required: true}],
  id: "eval-partial",
  judgePromptName: "judge-prompt",
  name: "partial judge",
  runModes,
  target: "full trace",
  type: "llm-judge",
};

const fullJudge: EvaluatorRecord = {
  calibration: {
    datasetName: "gold",
    experimentId: "exp-new",
    experimentName: "new",
    passed: true,
    rate: 0.95,
    stale: false,
  },
  confidenceAlertBelow: 0.5,
  dimensions: [
    {dataType: "boolean", key: "correct", required: true},
    {dataType: "categorical", key: "tone", range: "safe|unsafe", required: true},
  ],
  id: "eval-full",
  judgePromptName: "judge-prompt",
  name: "full judge",
  runModes,
  target: "full trace",
  type: "llm-judge",
};

const judged: DatasetRecord = {
  counts: {auto: 0, human: 3, needsReview: 0, total: 5},
  created: "2026-01-01T00:00:00.000Z",
  id: "ds-judged",
  judgments: [
    {
      answered: 4,
      current: 3,
      evaluatorId: "eval-human",
      evaluatorName: "review queue",
      stale: 1,
      total: 5,
    },
  ],
  name: "gold",
  tags: [],
  updated: "2026-01-02T00:00:00.000Z",
};

const unjudged: DatasetRecord = {
  counts: {auto: 0, human: 0, needsReview: 2, total: 2},
  created: "2026-01-01T00:00:00.000Z",
  id: "ds-plain",
  name: "plain",
  tags: [],
  updated: "2026-01-02T00:00:00.000Z",
};

const promptDetail: PromptDetail = {
  folder: "ops",
  labels: [
    {label: "latest", version: 2},
    {label: "production", version: 1},
  ],
  name: "judge-prompt",
  relationships: {
    experiments: {items: [], limit: 20, total: 0},
    traces: {items: [], limit: 20, total: 0},
  },
  tags: [],
  usedBy: {items: [], limit: 20, total: 0},
  versions: [
    {sensitive: false, template: "v1", type: "text", variables: [], version: 1},
    {sensitive: false, template: "v2", type: "text", variables: [], version: 2},
  ],
};

const handlers = {
  onDatasetChange: mock(() => undefined),
  onJudgeChange: mock(() => undefined),
  onModelOverrideChange: mock(() => undefined),
  onOpenDataset: mock(() => undefined),
  onQuestionSetChange: mock(() => undefined),
  onRun: mock(() => undefined),
  onStepChange: mock(() => undefined),
  onTargetAgreementChange: mock(() => undefined),
  onVersionToggle: mock(() => undefined),
};

const base = {
  ...handlers,
  datasetId: "ds-judged",
  datasets: [judged, unjudged],
  evaluators: [human, partialJudge, fullJudge],
  isCreating: false,
  isEstimating: false,
  judgeEvaluatorId: "eval-partial",
  judgePromptDetail: promptDetail,
  modelOverride: "",
  questionSetId: "eval-human",
  step: 1 as const,
  targetAgreement: "90",
  versions: [1, 2],
};

describe("judgesForQuestionSet", () => {
  it("returns no judges until a question set is chosen, then most overlap first", () => {
    expect(judgesForQuestionSet([human, partialJudge], undefined)).toEqual([]);
    const ranked = judgesForQuestionSet([human, partialJudge, fullJudge], human);
    expect(ranked.map((entry) => entry.judge.id)).toEqual(["eval-full", "eval-partial"]);
  });
});

describe("AiJudgeExperimentSteps", () => {
  beforeEach(() => {
    for (const handler of Object.values(handlers)) {
      handler.mockClear();
    }
  });

  it("shows an empty dataset step and a dataset that still needs human answers", async () => {
    const empty = renderWithTheme(<AiJudgeExperimentSteps {...base} datasetId="" datasets={[]} />);
    expect(empty.getByTestId("ai-judge-datasets-empty")).toBeTruthy();
    empty.unmount();

    const view = renderWithTheme(
      <AiJudgeExperimentSteps {...base} datasetId="" datasets={[unjudged]} />
    );
    expect(view.getByTestId("ai-judge-dataset-ds-plain-disabled")).toBeTruthy();
    expect(view.getByText(/No current human answers yet/)).toBeTruthy();
    fireEvent.press(view.getByTestId("ai-judge-dataset-send-review-ds-plain"));
    await waitFor(() => {
      expect(handlers.onOpenDataset).toHaveBeenCalledWith("ds-plain");
    });
    expect(view.getByTestId("ai-judge-dataset-help")).toBeTruthy();
  });

  it("selects a judged dataset and names stale answers", async () => {
    const view = renderWithTheme(<AiJudgeExperimentSteps {...base} />);
    expect(view.getByTestId("ai-judge-dataset-reuse")).toBeTruthy();
    expect(view.getByTestId("ai-judge-dataset-stale-ds-judged-eval-human")).toBeTruthy();
    fireEvent.press(view.getByTestId("ai-judge-dataset-ds-judged-clickable"));
    await waitFor(() => {
      expect(handlers.onDatasetChange).toHaveBeenCalledWith("ds-judged");
    });
  });

  it("lists the human questions, including stale answers left out", () => {
    const view = renderWithTheme(<AiJudgeExperimentSteps {...base} step={2} />);
    expect(view.getByText(/stale answers/)).toBeTruthy();
    expect(view.getByText("Question 1: correct")).toBeTruthy();
    expect(view.getByText("Question 2: tone")).toBeTruthy();
  });

  it("explains when no LLM judge shares the question keys", () => {
    const view = renderWithTheme(
      <AiJudgeExperimentSteps {...base} evaluators={[human]} judgeEvaluatorId="" step={3} />
    );
    expect(view.getByTestId("ai-judge-judges-empty")).toBeTruthy();
  });

  it("shows a stale calibration, uncovered questions, and toggles a prompt version", async () => {
    const view = renderWithTheme(<AiJudgeExperimentSteps {...base} step={3} />);
    expect(view.getByText("Out of date")).toBeTruthy();
    expect(view.getByText(/Not graded on tone/)).toBeTruthy();
    fireEvent.press(view.getByTestId("ai-judge-version-1-clickable"));
    await waitFor(() => {
      expect(handlers.onVersionToggle).toHaveBeenCalledWith(1);
    });
    expect(view.getByText("latest")).toBeTruthy();
  });

  it("shows a current calibration meter when the judge is up to date", () => {
    const view = renderWithTheme(
      <AiJudgeExperimentSteps {...base} judgeEvaluatorId="eval-full" step={3} />
    );
    expect(view.getByTestId("ai-judge-current-calibration")).toBeTruthy();
    expect(view.queryByTestId("ai-judge-uncovered")).toBeNull();
  });

  it("reviews the plan, the estimate, and a bad target", async () => {
    const view = renderWithTheme(
      <AiJudgeExperimentSteps
        {...base}
        estimate={{costUsd: 0.02, generations: 6, wallClockSeconds: 90}}
        estimateError="Estimate failed"
        isCreating
        step={4}
        targetAgreement="0"
      />
    );
    expect(view.getByText(/partial judge/)).toBeTruthy();
    expect(view.getByTestId("ai-judge-estimate")).toBeTruthy();
    expect(view.getByText("Estimate failed")).toBeTruthy();
    expect(view.getByText("Enter a percent between 1 and 100.")).toBeTruthy();
    fireEvent.press(view.getByTestId("ai-judge-back"));
    await waitFor(() => {
      expect(handlers.onStepChange).toHaveBeenCalledWith(3);
    });
  });

  it("shows the estimating spinner before a cost comes back", () => {
    const view = renderWithTheme(
      <AiJudgeExperimentSteps {...base} isEstimating step={4} targetAgreement="" />
    );
    expect(view.getByTestId("ai-judge-estimating")).toBeTruthy();
    expect(view.getByText(/the target agreement/)).toBeTruthy();
  });
});
