import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiExperimentsListView,
  type AiExperimentsListViewProps,
} from "../../src/widgets/aiObservability/experiments/AiExperimentsListView";
import type {ExperimentRecord} from "../../src/widgets/aiObservability/experiments/experimentTypes";

const STATUSES: ExperimentRecord["status"][] = ["completed", "running", "failed"];
const experiments: ExperimentRecord[] = Array.from({length: 9}, (_, index) => ({
  created: "2026-01-01T00:00:00.000Z",
  datasetId: `ds-${index % 3}`,
  datasetName: `dataset-${index % 3}`,
  evaluatorIds: ["eval-1"],
  id: `exp-${index}`,
  includeUnproofread: false,
  items: [],
  kind: index % 2 === 0 ? ("prompt" as const) : ("judge" as const),
  name: `Experiment ${index}`,
  promptName: "summarize",
  results: {
    gates: [
      {
        actual: 0.7 + index / 100,
        aggregate: "trueRate" as const,
        dimension: "correct",
        evaluatorName: "correctness",
        op: "gte" as const,
        passed: index % 2 === 0,
        value: 0.8,
        version: 1,
      },
    ],
    lowConfidenceItemIds: [],
    outlierItemIds: [],
    progress: {completed: index, total: 9},
    totalCostUsd: index / 10,
  },
  status: STATUSES[index % 3] as ExperimentRecord["status"],
  thresholds: [],
  updated: "2026-01-01T00:05:00.000Z",
  versions: [1],
}));
const datasetNames: Record<string, string> = {"ds-0": "Gold", "ds-1": "Silver", "ds-2": "Bronze"};
const noop = (): void => {};
const baseline: AiExperimentsListViewProps = {
  datasetNames,
  experiments,
  isLoading: false,
  onCreate: noop,
  onOpenResults: noop,
  onRetry: noop,
};

describe("AiExperimentsListView renders", () => {
  it("keeps the table cells mounted when the caller passes new handlers", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiExperimentsListView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => view.rerender(<AiExperimentsListView {...baseline} />));
    const latestOnOpen = mock((_id: string): void => {});
    await audit.step("new callbacks", () =>
      view.rerender(
        <AiExperimentsListView
          {...baseline}
          onCreate={(): void => {}}
          onOpenResults={latestOnOpen}
          onRetry={(): void => {}}
        />
      )
    );
    // The stable cell must still call the newest handler.
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-open-exp-2"));
    });
    expect(latestOnOpen).toHaveBeenCalledWith("exp-2");
    await audit.step("reset", () => view.rerender(<AiExperimentsListView {...baseline} />));
    await audit.step("new equal experiments", () =>
      view.rerender(<AiExperimentsListView {...baseline} experiments={[...experiments]} />)
    );
    await audit.step("reset 2", () => view.rerender(<AiExperimentsListView {...baseline} />));
    await audit.step("new equal datasetNames", () =>
      view.rerender(<AiExperimentsListView {...baseline} datasetNames={{...datasetNames}} />)
    );
    await audit.step("reset 3", () => view.rerender(<AiExperimentsListView {...baseline} />));
    await audit.step("kind filter", async () => {
      await act(async () => {
        fireEvent.press(view.getAllByText("Judge calibration")[0] as never);
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiExperimentsListView\n${formatReport(report, {limit: 40})}`);
    }
    expect(componentStat(report, "mount", "experimentName")?.mounts).toBe(experiments.length);
    // A rebuilt cell map shows up as custom cells mounting again and every row updating.
    for (const step of ["new callbacks", "reset"]) {
      expect(componentStat(report, step, "experimentName")).toBeUndefined();
      expect(componentStat(report, step, "ResultCell")).toBeUndefined();
      expect(componentStat(report, step, "StatusCell")).toBeUndefined();
    }
  });
});
