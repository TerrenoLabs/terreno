import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiExperimentResultsView,
  type AiExperimentResultsViewProps,
} from "../../src/widgets/aiObservability/experiments/AiExperimentResultsView";
import type {
  ExperimentGateResult,
  ExperimentRecord,
} from "../../src/widgets/aiObservability/experiments/experimentTypes";

const DIMENSIONS = ["correct", "helpful", "schema_valid", "tone"];
const gates: ExperimentGateResult[] = [1, 2].flatMap((version) =>
  DIMENSIONS.map((dimension) => ({
    actual: 0.9,
    aggregate: "trueRate" as const,
    dimension,
    evaluatorName: `${dimension}-eval`,
    op: "gte" as const,
    passed: true,
    value: 0.8,
    version,
  }))
);
const experiment: ExperimentRecord = {
  created: "2026-01-01T00:00:00.000Z",
  datasetId: "ds-1",
  evaluatorIds: ["eval-1"],
  id: "exp-1",
  includeUnproofread: false,
  items: Array.from({length: 10}, (_, index) => ({
    datasetItemId: `item-${index}`,
    failed: false,
    id: `row-${index}`,
    versionResults: {
      "1": {evaluatorScores: {}, output: `Output one ${index}`},
      "2": {evaluatorScores: {}, output: `Output two ${index}`},
    },
  })),
  name: "compare",
  promptName: "summarize",
  results: {
    gates,
    lowConfidenceItemIds: [],
    outlierItemIds: ["item-1", "item-3"],
    progress: {completed: 10, total: 10},
  },
  status: "completed",
  thresholds: [],
  updated: "2026-01-01T00:05:00.000Z",
  versions: [1, 2],
};
const noop = (): void => {};
const baseline: AiExperimentResultsViewProps = {
  experiment,
  isPromoting: false,
  onDismissPromoteConfirm: noop,
  onPromote: noop,
  onSelectVersion: noop,
  promoteConfirmOpen: false,
  promoteVersion: 2,
};

describe("AiExperimentResultsView renders", () => {
  it("re-renders the gates table only when the experiment changes", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiExperimentResultsView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    const steps: Array<[string, AiExperimentResultsViewProps]> = [
      ["same props", baseline],
      [
        "new callbacks",
        {
          ...baseline,
          onDismissPromoteConfirm: (): void => {},
          onPromote: (): void => {},
          onSelectVersion: (): void => {},
        },
      ],
      ["reset", baseline],
      ["promote version 1", {...baseline, promoteVersion: 1}],
      ["reset 2", baseline],
      ["confirm open", {...baseline, promoteConfirmOpen: true}],
      ["promoting", {...baseline, isPromoting: true, promoteConfirmOpen: true}],
      ["reset 3", baseline],
      ["promote error", {...baseline, promoteError: "Nope"}],
      ["reset 4", baseline],
      ["new equal experiment", {...baseline, experiment: {...experiment}}],
    ];
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiExperimentResultsView {...props} />));
    }
    await audit.step("layout", async () => {
      await act(async () => {
        fireEvent(view.getByTestId("ai-experiment-items-table-container"), "layout", {
          nativeEvent: {layout: {height: 400, width: 1200, x: 0, y: 0}},
        });
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiExperimentResultsView\n${formatReport(report, {limit: 25})}`);
    }
    expect(componentStat(report, "mount", "GatesTable")?.mounts).toBe(1);
    const steadySteps = ["same props", "new callbacks", "promote version 1", "confirm open"];
    for (const step of steadySteps) {
      expect(componentStat(report, step, "GatesTable")).toBeUndefined();
      expect(componentStat(report, step, "PassFailBadge")).toBeUndefined();
    }
    // Measuring the items table re-renders its own pass/fail cells, not the gates.
    expect(componentStat(report, "layout", "GatesTable")).toBeUndefined();
    // A new experiment payload recomputes the gate summaries, so the table renders once.
    expect(componentStat(report, "new equal experiment", "GatesTable")?.updates).toBe(1);
  });
});
