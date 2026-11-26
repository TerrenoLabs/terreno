import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiReviewQueueView,
  type AiReviewQueueViewProps,
} from "../../src/widgets/aiObservability/review/AiReviewQueueView";
import type {ReviewListItem} from "../../src/widgets/aiObservability/review/reviewTypes";

const items: ReviewListItem[] = Array.from({length: 9}, (_, index) => ({
  enqueuedAt: "2026-01-01T00:00:00.000Z",
  evaluatorId: "qs",
  id: `r-${index}`,
  outputPreview: `Output ${index}`,
  promptName: "example-summarize",
  reason: "manual",
  status: "pending",
  traceName: "summarize",
}));
const counts = {done: 2, in_progress: 1, pending: 9, skipped: 0};
const questionSetNames = {qs: "summary-questions"};
const noop = (): void => {};
const baseline: AiReviewQueueViewProps = {
  counts,
  items,
  onOpenItem: noop,
  onOpenTraces: noop,
  onRetry: noop,
  onStatusChange: noop,
  questionSetNames,
  status: "pending",
};

describe("AiReviewQueueView renders", () => {
  it("keeps the output cells mounted when the caller passes a new open handler", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    const latestOnOpenItem = mock((_id: string): void => {});
    const steps: Array<[string, AiReviewQueueViewProps]> = [
      ["same props", baseline],
      ["new open callback", {...baseline, onOpenItem: latestOnOpenItem}],
      ["reset", baseline],
      [
        "new other callbacks",
        {...baseline, onRetry: (): void => {}, onStatusChange: (): void => {}},
      ],
      ["new equal counts", {...baseline, counts: {...counts}}],
      ["new equal names", {...baseline, questionSetNames: {...questionSetNames}}],
      ["new equal items", {...baseline, items: [...items]}],
      ["status done", {...baseline, status: "done"}],
    ];
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiReviewQueueView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiReviewQueueView {...props} />));
      if (label === "new open callback") {
        // The stable cells must still call the newest handler.
        await act(async () => {
          fireEvent.press(view.getByTestId("ai-review-open-r-2"));
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
      }
    }
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiReviewQueueView\n${formatReport(report, {limit: 40})}`);
    }
    expect(latestOnOpenItem).toHaveBeenCalledWith("r-2");
    expect(componentStat(report, "mount", "reviewOutput")?.mounts).toBe(items.length);
    // A rebuilt cell map shows up as cells mounting again and every row updating.
    for (const step of ["same props", "new open callback", "reset"]) {
      expect(componentStat(report, step, "reviewOutput")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
  });
});
