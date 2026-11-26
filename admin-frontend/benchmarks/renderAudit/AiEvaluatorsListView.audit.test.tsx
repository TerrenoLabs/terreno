import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiEvaluatorsListView,
  type AiEvaluatorsListViewProps,
} from "../../src/widgets/aiObservability/evaluators/AiEvaluatorsListView";
import type {EvaluatorRecord} from "../../src/widgets/aiObservability/evaluators/evaluatorTypes";

const TYPES: EvaluatorRecord["type"][] = ["human", "llm-judge", "json-assert"];
const evaluators: EvaluatorRecord[] = Array.from({length: 9}, (_, index) => ({
  calibration:
    index % 3 === 1
      ? {
          experimentId: "e",
          experimentName: "exp",
          passed: true,
          rate: 0.8,
          stale: false,
          version: 1,
        }
      : undefined,
  confidenceAlertBelow: 0.5,
  description: `Description ${index}`,
  dimensions: [{dataType: "boolean" as const, key: "ok", required: true}],
  id: `ev-${index}`,
  name: `Evaluator ${index}`,
  runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0.1},
  target: "full trace" as const,
  type: TYPES[index % 3] as EvaluatorRecord["type"],
}));
const noop = (): void => {};
const baseline: AiEvaluatorsListViewProps = {
  evaluators,
  isLoading: false,
  onCreate: noop,
  onOpen: noop,
  onRetry: noop,
};

describe("AiEvaluatorsListView renders", () => {
  it("keeps the name cells mounted when the caller passes new handlers", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiEvaluatorsListView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => view.rerender(<AiEvaluatorsListView {...baseline} />));
    const latestOnOpen = mock((_id: string): void => {});
    await audit.step("new callbacks", () =>
      view.rerender(
        <AiEvaluatorsListView
          {...baseline}
          onCreate={(): void => {}}
          onOpen={latestOnOpen}
          onRetry={(): void => {}}
        />
      )
    );
    // The stable cell must still call the newest handler.
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-open-ev-2"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(latestOnOpen).toHaveBeenCalledWith("ev-2");
    await audit.step("reset", () => view.rerender(<AiEvaluatorsListView {...baseline} />));
    await audit.step("new equal evaluators", () =>
      view.rerender(<AiEvaluatorsListView {...baseline} evaluators={[...evaluators]} />)
    );
    await audit.step("reset 2", () => view.rerender(<AiEvaluatorsListView {...baseline} />));
    await audit.step("kind filter", async () => {
      await act(async () => {
        fireEvent.press(view.getAllByText("Human")[0] as never);
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiEvaluatorsListView\n${formatReport(report, {limit: 40})}`);
    }
    expect(componentStat(report, "mount", "evaluatorName")?.mounts).toBe(evaluators.length);
    // A rebuilt cell map shows up as name cells mounting again and every row updating.
    for (const step of ["same props", "new callbacks", "reset"]) {
      expect(componentStat(report, step, "evaluatorName")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
  });
});
