import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiReviewItemView} from "../widgets/aiObservability/review/AiReviewItemView";
import type {ReviewDetail} from "../widgets/aiObservability/review/reviewTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => undefined)},
}));

const longInput = Array.from({length: 45}, (_, index) => `word${index}`).join(" ");
const detail: ReviewDetail = {
  dimensions: [{dataType: "boolean", key: "correct", required: true}],
  evaluatorId: "evaluator-1",
  id: "review-1",
  instructions: "Mark correct only when grounded.",
  panels: {
    given: [{key: "note", label: "Clinical note", note: "Check identifiers.", value: longInput}],
    wrote: [{key: "summary", label: "Summary", value: "Short output"}],
  },
  rawInput: {note: longInput},
  rawOutput: {summary: "Short output"},
  status: "pending",
  traceId: "trace-1",
};

describe("AiReviewItemView", () => {
  it("shows pending position, collapsed long fields, reviewer notes, and raw JSON", () => {
    const {getByTestId, getByText, queryByText} = renderWithTheme(
      <AiReviewItemView
        comment=""
        detail={detail}
        isPending
        onAssign={() => undefined}
        onCommentChange={() => undefined}
        onScoreChange={() => undefined}
        onSkip={() => undefined}
        onSubmit={() => undefined}
        position={1}
        scores={{}}
        totalPending={2}
      />
    );
    expect(getByText("Item 1 of 2 pending")).toBeTruthy();
    expect(getByText("45 words")).toBeTruthy();
    expect(queryByText(longInput)).toBeNull();
    expect(getByTestId("ai-review-raw-json")).toBeTruthy();
    expect(queryByText(/"input"/)).toBeNull();
    fireEvent.press(getByTestId("ai-review-field-note.toggle"));
    expect(getByText("Check identifiers.")).toBeTruthy();
  });

  it("wires submit, skip, and assign actions", async () => {
    const onAssign = mock(() => undefined);
    const onSkip = mock(() => undefined);
    const onSubmit = mock(() => undefined);
    const {getByTestId} = renderWithTheme(
      <AiReviewItemView
        comment=""
        detail={detail}
        isPending
        onAssign={onAssign}
        onCommentChange={() => undefined}
        onScoreChange={() => undefined}
        onSkip={onSkip}
        onSubmit={onSubmit}
        position={1}
        scores={{correct: true}}
        totalPending={1}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("ai-review-submit-next"));
      fireEvent.press(getByTestId("ai-review-skip"));
      fireEvent.press(getByTestId("ai-review-assign"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onSubmit).toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalled();
    expect(onAssign).toHaveBeenCalled();
  });

  it("shows non-pending copy, navigation buttons, submit error, and comment editing", async () => {
    const onNext = mock(() => undefined);
    const onPrevious = mock(() => undefined);
    const onCommentChange = mock(() => undefined);
    const {getByTestId, getByText} = renderWithTheme(
      <AiReviewItemView
        comment="needs work"
        detail={{...detail, status: "done"}}
        isPending={false}
        onAssign={() => undefined}
        onCommentChange={onCommentChange}
        onNext={onNext}
        onPrevious={onPrevious}
        onScoreChange={() => undefined}
        onSkip={() => undefined}
        onSubmit={() => undefined}
        position={1}
        scores={{correct: true}}
        submitError="Could not submit this review."
        totalPending={0}
      />
    );
    expect(getByText(/not in pending queue/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText("Previous"));
      fireEvent.press(getByText("Next"));
      await Promise.resolve();
    });
    expect(onPrevious).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
    expect(getByText("Could not submit this review.")).toBeTruthy();
    fireEvent.changeText(getByTestId("ai-review-comment"), "updated");
    expect(onCommentChange).toHaveBeenCalledWith("updated");
  });

  it("scores boolean dimensions when navigation handlers are absent", async () => {
    const onScoreChange = mock(() => undefined);
    const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
      <AiReviewItemView
        comment=""
        detail={detail}
        isPending
        onAssign={() => undefined}
        onCommentChange={() => undefined}
        onScoreChange={onScoreChange}
        onSkip={() => undefined}
        onSubmit={() => undefined}
        position={1}
        scores={{}}
        totalPending={1}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("ai-review-score-correct-pass"));
      await Promise.resolve();
    });
    assert.isAtLeast(onScoreChange.mock.calls.length, 1);
    expect(getByText("Previous")).toBeTruthy();
    expect(getByText("Next")).toBeTruthy();
    const navButtons = UNSAFE_root.findAllByProps({text: "Previous"}).filter(
      (node) => typeof node.props.onClick === "function"
    );
    const nextButtons = UNSAFE_root.findAllByProps({text: "Next"}).filter(
      (node) => typeof node.props.onClick === "function"
    );
    assert.isAtLeast(navButtons.length, 1);
    assert.isAtLeast(nextButtons.length, 1);
    navButtons[0]!.props.onClick();
    nextButtons[0]!.props.onClick();
  });

  it("expands raw JSON accordion content", async () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiReviewItemView
        comment=""
        detail={detail}
        isPending
        onAssign={() => undefined}
        onCommentChange={() => undefined}
        onScoreChange={() => undefined}
        onSkip={() => undefined}
        onSubmit={() => undefined}
        position={1}
        scores={{}}
        totalPending={1}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("ai-review-raw-json.toggle"));
      await Promise.resolve();
    });
    expect(getByText(/"input"/)).toBeTruthy();
  });

  it("shows saving state, instructions, raw JSON, and multi-dimension scoring", async () => {
    const onScoreChange = mock(() => undefined);
    const multiDetail: ReviewDetail = {
      ...detail,
      dimensions: [
        {dataType: "boolean", key: "correct", required: true},
        {dataType: "numeric", key: "helpfulness", range: "0-1", required: true},
        {dataType: "categorical", key: "tone", range: "safe|unsafe", required: true},
      ],
      instructions: undefined,
    };
    const {getByTestId, getByText, queryByText} = renderWithTheme(
      <AiReviewItemView
        comment=""
        detail={multiDetail}
        isPending
        isSaving
        onAssign={() => undefined}
        onCommentChange={() => undefined}
        onScoreChange={onScoreChange}
        onSkip={() => undefined}
        onSubmit={() => undefined}
        position={2}
        scores={{correct: true, helpfulness: 0.7}}
        totalPending={3}
      />
    );
    expect(getByText("Item 2 of 3 pending")).toBeTruthy();
    expect(queryByText("Mark correct only when grounded.")).toBeNull();
    await act(async () => {
      fireEvent.press(getByTestId("ai-review-score-tone-safe"));
      await Promise.resolve();
    });
    assert.isAtLeast(onScoreChange.mock.calls.length, 1);
    const skip = getByTestId("ai-review-skip");
    expect(skip.props.accessibilityState?.disabled ?? skip.props.disabled).toBeTruthy();
  });
});
