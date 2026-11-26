import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiReviewItemView,
  type AiReviewItemViewProps,
} from "../../src/widgets/aiObservability/review/AiReviewItemView";
import type {ReviewDetail} from "../../src/widgets/aiObservability/review/reviewTypes";

const LONG_TEXT = Array.from({length: 60}, (_, index) => `word${index}`).join(" ");
const detail: ReviewDetail = {
  dimensions: [
    ...Array.from({length: 8}, (_, index) => ({
      dataType: "boolean" as const,
      key: `q${index}`,
      question: `Is answer ${index} right?`,
      required: true,
    })),
    {dataType: "numeric" as const, key: "quality", question: "Rate quality", required: false},
    {dataType: "categorical" as const, key: "tone", range: "warm,neutral,cold", required: false},
  ],
  evaluatorId: "qs",
  id: "r1",
  instructions: "Answer every question.",
  panels: {
    given: Array.from({length: 8}, (_, index) => ({
      key: `given-${index}`,
      label: `Input ${index}`,
      value: index % 2 === 0 ? `Value ${index}` : LONG_TEXT,
    })),
    wrote: Array.from({length: 8}, (_, index) => ({
      key: `wrote-${index}`,
      label: `Output ${index}`,
      note: "From the model",
      value: index % 2 === 0 ? `Value ${index}` : LONG_TEXT,
    })),
  },
  rawInput: {text: LONG_TEXT},
  rawOutput: {summary: LONG_TEXT},
  status: "pending",
  traceId: "t1",
};
const scores: Record<string, boolean | number | string> = {q0: true};
const noop = (): void => {};
const baseline: AiReviewItemViewProps = {
  activeQuestionKey: "q1",
  comment: "",
  detail,
  onAssign: noop,
  onCommentChange: noop,
  onScoreChange: noop,
  onSkip: noop,
  onSubmit: noop,
  scores,
};

describe("AiReviewItemView renders", () => {
  it("re-renders only what a keystroke or an answer changes", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    const latestOnScoreChange = mock((_key: string, _value: boolean | number | string): void => {});
    const steps: Array<[string, AiReviewItemViewProps]> = [
      ["same props", baseline],
      ["type comment", {...baseline, comment: "L"}],
      ["reset", baseline],
      // The screen rebuilds onScoreChange and onSubmit whenever scores change.
      [
        "answer one question",
        {
          ...baseline,
          activeQuestionKey: "q2",
          onScoreChange: latestOnScoreChange,
          onSubmit: (): void => {},
          scores: {...scores, q1: false},
        },
      ],
      ["reset 2", baseline],
      ["move highlight", {...baseline, activeQuestionKey: "q2"}],
      ["reset 3", baseline],
      ["new callbacks", {...baseline, onScoreChange: (): void => {}, onSkip: (): void => {}}],
      ["new equal scores", {...baseline, scores: {...scores}}],
      ["saving", {...baseline, isSaving: true}],
    ];
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiReviewItemView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiReviewItemView {...props} />));
      if (label === "answer one question") {
        // Rows that skipped the render must still call the newest handler.
        await act(async () => {
          fireEvent.press(view.getByTestId("ai-review-question-q5-yes"));
          await Promise.resolve();
        });
      }
    }
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiReviewItemView\n${formatReport(report, {limit: 40})}`);
    }
    expect(latestOnScoreChange).toHaveBeenCalledWith("q5", true);
    expect(componentStat(report, "mount", "QuestionRowComponent")?.mounts).toBe(10);
    expect(componentStat(report, "mount", "FieldValue")?.mounts).toBe(16);
    // A keystroke in the note reaches neither the questions nor the read-only panels.
    for (const step of ["same props", "type comment", "reset"]) {
      expect(componentStat(report, step, "ReviewQuestionListComponent")).toBeUndefined();
      expect(componentStat(report, step, "QuestionRowComponent")).toBeUndefined();
      expect(componentStat(report, step, "ReviewReadOnlyPanelComponent")).toBeUndefined();
      expect(componentStat(report, step, "FieldValue")).toBeUndefined();
      expect(componentStat(report, step, "ReviewRawJsonComponent")).toBeUndefined();
    }
    // An answer re-renders the answered row and the newly highlighted row, not all ten.
    expect(componentStat(report, "answer one question", "QuestionRowComponent")?.updates).toBe(2);
    expect(componentStat(report, "move highlight", "QuestionRowComponent")?.updates).toBe(2);
    expect(componentStat(report, "answer one question", "FieldValue")).toBeUndefined();
    expect(componentStat(report, "new callbacks", "QuestionRowComponent")).toBeUndefined();
  });
});
