import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AiReviewBatchesView} from "./AiReviewBatchesView";
import {AiReviewBatchView} from "./AiReviewBatchView";
import type {ReviewBatchDetail} from "./batchTypes";
import {ReviewQuestionList} from "./ReviewQuestionList";

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
  });
};

const QUESTIONS = [
  {dataType: "boolean" as const, key: "faithful", question: "Is it faithful?", required: true},
  {dataType: "boolean" as const, key: "concise", question: "Is it concise?", required: true},
];

const judge = (evaluatorId: string, rate: number, disagreements = 0) => ({
  agreement: {
    compared: 4,
    disagreements: Array.from({length: disagreements}, () => ({
      human: true,
      judge: false,
      key: "concise",
      traceId: "t2",
    })),
    errors: 0,
    itemsCompared: 2,
    matches: Math.round(rate * 4),
    questions: [
      {compared: 2, covered: true, key: "faithful", matches: 2, rate: 1},
      {compared: 2, covered: true, key: "concise", matches: 2 - disagreements, rate: rate},
    ],
    rate,
  },
  completedAt: "2026-10-15T00:00:00.000Z",
  evaluatorId,
  evaluatorName: `${evaluatorId}-name`,
  runId: `run-${evaluatorId}`,
});

const batch: ReviewBatchDetail = {
  counts: {done: 2, pending: 1, skipped: 0, total: 3},
  created: "2026-10-15T00:00:00.000Z",
  dimensions: QUESTIONS,
  evaluatorId: "qs",
  evaluatorName: "summary-questions",
  id: "b1",
  items: [
    {
      judgeAnswers: {careful: {scores: {concise: true, faithful: true}}},
      output: "First summary",
      reviewItemId: "r1",
      scores: {concise: true, faithful: true},
      status: "done",
      traceId: "t1",
      traceName: "summarize",
    },
    {
      judgeAnswers: {quick: {scores: {concise: false, faithful: true}}},
      output: "Second summary",
      reviewItemId: "r2",
      scores: {concise: true, faithful: true},
      status: "done",
      traceId: "t2",
      traceName: "summarize",
    },
    {
      judgeAnswers: {},
      output: "Third summary",
      reviewItemId: "r3",
      status: "pending",
      traceId: "t3",
      traceName: "summarize",
    },
  ],
  judgeCount: 2,
  judges: [judge("careful", 1), judge("quick", 0.75, 1)],
  name: "Recent summaries",
  promptName: "example-summarize",
};

describe("ReviewQuestionList", () => {
  it("answers every question on one screen", async () => {
    const onAnswer = mock(() => {});
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <ReviewQuestionList dimensions={QUESTIONS} onAnswer={onAnswer} scores={{faithful: true}} />
    );
    expect(getByText("1. Is it faithful?")).toBeTruthy();
    expect(getByText("1 of 2 answered")).toBeTruthy();
    expect(queryByTestId("ai-review-questions-rest-yes")).toBeNull();
    await press(getByTestId("ai-review-question-concise-no"));
    expect(onAnswer).toHaveBeenCalledWith("concise", false);
    await press(getByTestId("ai-review-question-faithful-yes"));
    expect(onAnswer).toHaveBeenCalledWith("faithful", true);
  });

  it("answers a focused Yes/No segment from Y and N", async () => {
    const onAnswer = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <ReviewQuestionList dimensions={QUESTIONS} onAnswer={onAnswer} scores={{}} />
    );
    const yes = getByTestId("ai-review-question-faithful-yes");
    await act(async () => {
      fireEvent(yes, "keyDown", {
        key: "n",
        preventDefault: () => undefined,
        target: {dataset: {reviewAnswer: "true"}, tagName: "DIV"},
      });
      await Promise.resolve();
    });
    expect(onAnswer).toHaveBeenCalledWith("faithful", false);
  });

  it("puts answers in a fixed left column and highlights the active question", () => {
    const view = renderWithTheme(
      <ReviewQuestionList
        activeKey="concise"
        dimensions={QUESTIONS}
        onAnswer={() => {}}
        scores={{}}
      />
    );
    expect(view.queryByText(/^Answer /)).toBeNull();
    const tree = JSON.stringify(view.toJSON());
    expect(tree.indexOf("ai-review-question-concise-no")).toBeLessThan(
      tree.indexOf("2. Is it concise?")
    );
    const style = (testID: string): string => JSON.stringify(view.getByTestId(testID).props.style);
    expect(style("ai-review-question-concise")).not.toBe(style("ai-review-question-faithful"));
    expect(style("ai-review-answer-concise")).toContain("220");
    expect(style("ai-review-answer-concise")).not.toContain('"flex":0');
    expect(style("ai-review-answer-faithful")).toContain("220");
  });

  it("answers non-boolean questions through the score field in the left column", async () => {
    const onAnswer = mock(() => {});
    const view = renderWithTheme(
      <ReviewQuestionList
        dimensions={[
          {
            dataType: "categorical",
            key: "tone",
            question: "What is the tone?",
            range: "safe|unsafe",
            required: true,
          },
        ]}
        onAnswer={onAnswer}
        scores={{}}
      />
    );
    expect(view.getByText("1. What is the tone?")).toBeTruthy();
    const tree = JSON.stringify(view.toJSON());
    expect(tree.indexOf("ai-review-score-tone-safe")).toBeLessThan(
      tree.indexOf("1. What is the tone?")
    );
    await press(view.getByTestId("ai-review-score-tone-safe"));
    expect(onAnswer).toHaveBeenCalledWith("tone", "safe");
  });
});

describe("AiReviewBatchView", () => {
  const renderBatch = (overrides: Partial<React.ComponentProps<typeof AiReviewBatchView>> = {}) => {
    const props = {
      batch,
      judgeId: "",
      judgeOptions: [{label: "careful", value: "careful"}],
      onJudgeChange: mock(() => {}),
      onOpenItem: mock(() => {}),
      onRunJudge: mock(() => {}),
      onSelectJudge: mock(() => {}),
      selectedJudge: batch.judges[1],
      ...overrides,
    };
    return {props, ...renderWithTheme(<AiReviewBatchView {...props} />)};
  };

  it("shows judge agreement, progress, and the selected judge's disagreements", () => {
    const {getByTestId, getByText, getAllByText, queryByText} = renderBatch();
    expect(getByTestId("ai-review-batch-progress")).toBeTruthy();
    expect(getByText("2 of 3")).toBeTruthy();
    expect(getAllByText("100%").length).toBeGreaterThan(0);
    expect(getAllByText("75%").length).toBeGreaterThan(0);
    expect(getAllByText("Matches").length).toBeGreaterThan(0);
    expect(getAllByText("Close").length).toBeGreaterThan(0);
    expect(getAllByText("careful-name").length).toBeGreaterThan(1);
    expect(getByTestId("ai-review-batch-judge-count")).toBeTruthy();
    expect(getAllByText("2").length).toBeGreaterThan(0);
    expect(getByText("Where quick-name disagrees (1)")).toBeTruthy();
    expect(getByText("Judge said No")).toBeTruthy();
    expect(getByTestId("ai-review-batch-judge-selected-quick")).toBeTruthy();
    expect(queryByText(/Q1/)).toBeNull();
    expect(getAllByText("Faithful").length).toBeGreaterThan(0);
  });

  it("runs a judge from the card with a secondary button", async () => {
    const {getByTestId, props, UNSAFE_root} = renderBatch({judgeId: "careful"});
    await press(getByTestId("ai-review-batch-run-judge"));
    expect(props.onRunJudge).toHaveBeenCalled();
    const run = UNSAFE_root.findAll(
      (node) => node.props.testID === "ai-review-batch-run-judge" && "variant" in node.props
    )[0];
    expect(run?.props.variant).toBe("secondary");
  });

  it("shows stale questions and dataset steps as banners", () => {
    const {getByTestId} = renderBatch({
      batch: {...batch, datasetId: "ds1", datasetName: "gold", questionsStale: true},
    });
    expect(getByTestId("ai-review-batch-questions-stale")).toBeTruthy();
    expect(getByTestId("ai-eval-step-banner")).toBeTruthy();
  });

  it("selects judges and opens items from table rows", async () => {
    const {getByTestId, props} = renderBatch();
    await press(getByTestId("ai-review-batch-judges-table-row-careful-clickable"));
    expect(props.onSelectJudge).toHaveBeenCalledWith("careful");
    await press(getByTestId("ai-review-batch-disagreements-table-row-t2-concise-0-clickable"));
    expect(props.onOpenItem).toHaveBeenCalledWith("r2");
    await press(getByTestId("ai-review-batch-items-table-row-r1-clickable"));
    expect(props.onOpenItem).toHaveBeenCalledWith("r1");
  });

  it("blocks judge runs and says why when no AI is available", () => {
    const {getByTestId, getByText} = renderBatch({
      aiBlockedMessage: "Save a key first.",
      judgeId: "careful",
    });
    expect(getByText("Save a key first.")).toBeTruthy();
    expect(getByTestId("ai-review-batch-run-judge").props.accessibilityState?.disabled).toBe(true);
  });

  it("explains an empty judge table", () => {
    const {getByTestId} = renderBatch({
      batch: {...batch, judgeCount: 0, judges: []},
      selectedJudge: undefined,
    });
    expect(getByTestId("ai-review-batch-judges-empty")).toBeTruthy();
  });
});

describe("AiReviewBatchesView", () => {
  it("lists batches with the best judge and opens one", async () => {
    const onOpenBatch = mock(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <AiReviewBatchesView
        batches={[
          {
            bestJudge: {evaluatorName: "careful-name", rate: 31 / 32},
            counts: batch.counts,
            created: batch.created,
            evaluatorId: "qs",
            evaluatorName: "summary-questions",
            id: "b1",
            judgeCount: 2,
            name: "Recent summaries",
          },
        ]}
        name=""
        onCreate={() => {}}
        onNameChange={() => {}}
        onOpenBatch={onOpenBatch}
        onPromptChange={() => {}}
        onQuestionSetChange={() => {}}
        onRetry={() => {}}
        promptName=""
        promptOptions={[{label: "example-summarize", value: "example-summarize"}]}
        questionSetId="qs"
        questionSetOptions={[{label: "summary-questions (2 questions)", value: "qs"}]}
      />
    );
    expect(getByText("97%")).toBeTruthy();
    expect(getByText("careful-name")).toBeTruthy();
    expect(getByText("2 of 3")).toBeTruthy();
    expect(getByText("summary-questions · Any prompt")).toBeTruthy();
    await press(getByTestId("ai-review-batches-open-b1"));
    expect(onOpenBatch).toHaveBeenCalledWith("b1");
  });

  it("shows an empty state", () => {
    const {getByTestId} = renderWithTheme(
      <AiReviewBatchesView
        batches={[]}
        name=""
        onCreate={() => {}}
        onNameChange={() => {}}
        onOpenBatch={() => {}}
        onPromptChange={() => {}}
        onQuestionSetChange={() => {}}
        onRetry={() => {}}
        promptName=""
        promptOptions={[]}
        questionSetId=""
        questionSetOptions={[]}
      />
    );
    expect(getByTestId("ai-review-batches-empty")).toBeTruthy();
  });
});
