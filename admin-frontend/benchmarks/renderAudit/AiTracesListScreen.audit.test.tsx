import {afterEach, describe, expect, it} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../src/testing/observabilityTestUtils";
import type {AdminConfigResponse} from "../../src/types";
import {AiTracesScreenWidget} from "../../src/widgets/aiObservability/traces/AiTracesListScreen";

const traces = Array.from({length: 10}, (_, index) => ({
  endedAt: "2026-01-02T00:00:02.000Z",
  flaggedForDataset: false,
  id: `trace-${index}`,
  name: `summarize-${index}`,
  prompts: [],
  scoreCount: index,
  sensitive: false,
  spanCount: index + 1,
  startedAt: "2026-01-02T00:00:00.000Z",
  status: "ok",
  usage: {costUsd: 0.02, inputTokens: 100, outputTokens: 50},
}));

let restoreFetch: () => void = () => undefined;

afterEach(() => {
  restoreFetch();
});

const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("AiTracesScreenWidget renders", () => {
  it("leaves the table rows alone when screen state outside the table changes", async () => {
    const {restore} = stubObservabilityFetch((request) => {
      if (request.url.includes("/ai/observability/traces?")) {
        return {body: {data: traces, limit: 20, more: false, page: 1, total: traces.length}};
      }
      if (request.url.includes("/ai/observability/evaluators")) {
        return {body: {data: [{id: "e1", name: "Quality", type: "human"}]}};
      }
      if (request.url.includes("/ai/observability/prompts")) {
        return {body: {data: [{latestVersion: 1, name: "greet", type: "chat"}]}};
      }
      if (request.url.includes("/ai/observability/datasets")) {
        return {body: {data: [{id: "d1", itemCount: 0, name: "Golden"}]}};
      }
      return {body: {data: {}}};
    });
    restoreFetch = restore;
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      mounted = renderWithTheme(
        <ObservabilityTestProvider>
          <AiTracesScreenWidget config={config} routeBase="/admin" screenName="ai-traces" />
        </ObservabilityTestProvider>
      );
      await waitFor(() => {
        expect(mounted?.getByTestId("ai-traces-select-trace-2-clickable")).toBeTruthy();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("select one row", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-select-trace-2-clickable"));
      });
    });
    await audit.step("open review modal", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-send-review"));
      });
    });
    const report = audit.report();
    audit.dispose();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiTracesScreenWidget\n${formatReport(report, {limit: 40})}`);
    }
    expect(componentStat(report, "mount", "DataTableRow")?.mounts).toBe(10);
    expect(view.queryByTestId("ai-traces-review-modal")).toBeTruthy();
    // Selection reaches only the select cells; the review modal reaches nothing in the table.
    expect(componentStat(report, "select one row", "TraceSelectCell")?.updates).toBe(10);
    for (const step of ["select one row", "open review modal"]) {
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
      expect(componentStat(report, step, "TraceNameCell")).toBeUndefined();
    }
    expect(componentStat(report, "open review modal", "TraceSelectCell")).toBeUndefined();
    view.unmount();
  });
});
