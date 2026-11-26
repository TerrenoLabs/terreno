import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiTracesListView,
  type AiTracesListViewProps,
} from "../../src/widgets/aiObservability/traces/AiTracesListView";
import type {TraceListItem} from "../../src/widgets/aiObservability/traces/traceTypes";

const traces: TraceListItem[] = Array.from(
  {length: 10},
  (_, index): TraceListItem => ({
    endedAt: "2026-01-02T00:00:02.000Z",
    flaggedForDataset: false,
    id: `trace-${index}`,
    name: `summarize-${index}`,
    prompts: [],
    scoreCount: index,
    sensitive: index % 3 === 0,
    spanCount: index + 1,
    startedAt: "2026-01-02T00:00:00.000Z",
    status: index % 4 === 0 ? "error" : "ok",
    tags: ["core"],
    usage: {costUsd: 0.02, inputTokens: 100, outputTokens: 50},
    userId: `user-${index}`,
  })
);
const noop = (): void => {};
const selectedIds: string[] = [];
const filterValues = {};
const promptOptions = ["greet", "remind"];
const evaluators = [{id: "e1", name: "Quality", type: "human" as const}];
const datasetOptions = [{id: "d1", name: "Golden"}];
const baseline: AiTracesListViewProps = {
  datasetId: "d1",
  datasetModalOpen: false,
  datasetOptions,
  evaluatorId: "e1",
  evaluators,
  filterValues,
  onAddToDataset: noop,
  onClearSelection: noop,
  onDatasetChange: noop,
  onDismissDatasetModal: noop,
  onDismissReviewModal: noop,
  onEnqueueReview: noop,
  onEvaluatorChange: noop,
  onFilterValuesChange: noop,
  onOpenAddToDataset: noop,
  onOpenReview: noop,
  onOpenTrace: noop,
  onPageChange: noop,
  onSortChange: noop,
  onToggleSelect: noop,
  page: 1,
  promptOptions,
  reviewModalOpen: false,
  routeBase: "/admin",
  selectedIds,
  total: 40,
  traces,
};

describe("AiTracesListView renders", () => {
  it("keeps the trace cells mounted when a row is selected or handlers change", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    const latestOnOpenTrace = mock((_id: string): void => {});
    const latestOnToggleSelect = mock((_id: string): void => {});
    const steps: Array<[string, AiTracesListViewProps]> = [
      ["same props", baseline],
      ["one row selected", {...baseline, selectedIds: ["trace-2"]}],
      ["two rows selected", {...baseline, selectedIds: ["trace-2", "trace-3"]}],
      ["reset", baseline],
      [
        "new cell callbacks",
        {...baseline, onOpenTrace: latestOnOpenTrace, onToggleSelect: latestOnToggleSelect},
      ],
      ["reset 2", baseline],
      [
        "new other callbacks",
        {...baseline, onDismissDatasetModal: (): void => {}, onDismissReviewModal: (): void => {}},
      ],
      [
        "new equal collections",
        {
          ...baseline,
          datasetOptions: [...datasetOptions],
          promptOptions: [...promptOptions],
          selectedIds: [],
        },
      ],
      ["reset 3", baseline],
      ["review modal open", {...baseline, reviewModalOpen: true}],
      ["reset 4", baseline],
      ["sort changed", {...baseline, sort: "-cost"}],
    ];
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiTracesListView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiTracesListView {...props} />));
      if (label === "new cell callbacks") {
        // The stable cells must still call the newest handlers.
        await act(async () => {
          fireEvent.press(view.getByTestId("ai-traces-select-trace-2-clickable"));
          fireEvent.press(view.getByTestId("ai-traces-open-trace-3"));
        });
      }
    }
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiTracesListView\n${formatReport(report, {limit: 40})}`);
    }
    expect(latestOnToggleSelect).toHaveBeenCalledWith("trace-2");
    expect(latestOnOpenTrace).toHaveBeenCalledWith("trace-3");
    expect(componentStat(report, "mount", "TraceNameCell")?.mounts).toBe(10);
    // Selecting reaches the ten select cells through context and nothing else in the table.
    for (const step of ["one row selected", "two rows selected", "reset"]) {
      expect(componentStat(report, step, "TraceSelectCell")?.mounts).toBe(0);
      expect(componentStat(report, step, "TraceSelectCell")?.updates).toBe(10);
      expect(componentStat(report, step, "TraceNameCell")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
    // A rebuilt cell map shows up as cells mounting again and every row updating.
    for (const step of ["same props", "new cell callbacks", "reset 2", "review modal open"]) {
      expect(componentStat(report, step, "TraceSelectCell")).toBeUndefined();
      expect(componentStat(report, step, "TraceNameCell")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
  });
});
