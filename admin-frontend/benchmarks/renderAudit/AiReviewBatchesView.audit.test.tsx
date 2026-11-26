import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiReviewBatchesView,
  type AiReviewBatchesViewProps,
} from "../../src/widgets/aiObservability/review/AiReviewBatchesView";
import type {ReviewBatchListItem} from "../../src/widgets/aiObservability/review/batchTypes";

const batches: ReviewBatchListItem[] = Array.from({length: 9}, (_, index) => ({
  bestJudge: index % 2 === 0 ? {evaluatorName: "careful", rate: 0.75} : undefined,
  counts: {done: index, pending: 9 - index, skipped: 0, total: 9},
  created: "2026-01-01T00:00:00.000Z",
  evaluatorId: "qs",
  evaluatorName: index % 3 === 0 ? "summary-questions" : "tone-questions",
  id: `b-${index}`,
  judgeCount: 1,
  name: `Batch ${index}`,
  promptName: "example-summarize",
}));
const options = [
  {label: "summary-questions (2 questions)", value: "qs"},
  {label: "tone-questions (1 question)", value: "tq"},
];
const noop = (): void => {};
const baseline: AiReviewBatchesViewProps = {
  batches,
  name: "",
  onCreate: noop,
  onNameChange: noop,
  onOpenBatch: noop,
  onPromptChange: noop,
  onQuestionSetChange: noop,
  onRetry: noop,
  promptName: "",
  promptOptions: options,
  questionSetId: "qs",
  questionSetOptions: options,
};

describe("AiReviewBatchesView renders", () => {
  it("keeps the batch cells mounted when the caller passes a new open handler", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    const latestOnOpenBatch = mock((_id: string): void => {});
    const steps: Array<[string, AiReviewBatchesViewProps]> = [
      ["same props", baseline],
      ["type name", {...baseline, name: "N"}],
      ["reset", baseline],
      ["new open callback", {...baseline, onOpenBatch: latestOnOpenBatch}],
      ["reset 2", baseline],
      ["new other callbacks", {...baseline, onCreate: (): void => {}, onRetry: (): void => {}}],
      ["new equal options", {...baseline, promptOptions: [...options]}],
      ["new equal batches", {...baseline, batches: [...batches]}],
    ];
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiReviewBatchesView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiReviewBatchesView {...props} />));
      if (label === "new open callback") {
        // The stable cells must still call the newest handler.
        await act(async () => {
          fireEvent.press(view.getByTestId("ai-review-batches-open-b-2"));
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
      }
    }
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiReviewBatchesView\n${formatReport(report, {limit: 40})}`);
    }
    expect(latestOnOpenBatch).toHaveBeenCalledWith("b-2");
    expect(componentStat(report, "mount", "batchName")?.mounts).toBe(batches.length);
    // A rebuilt cell map shows up as cells mounting again and every row updating.
    for (const step of ["same props", "type name", "new open callback", "reset 2"]) {
      expect(componentStat(report, step, "batchName")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
  });
});
