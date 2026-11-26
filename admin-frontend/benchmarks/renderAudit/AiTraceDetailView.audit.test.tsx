import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiTraceDetailView} from "../../src/widgets/aiObservability/traces/AiTraceDetailView";
import type {TraceDetail, TraceSpanNode} from "../../src/widgets/aiObservability/traces/traceTypes";

const buildSpan = (index: number, children: TraceSpanNode[] = []): TraceSpanNode => ({
  children,
  durationMs: 100 + index * 10,
  id: `span-${index}`,
  input: {prompt: `input ${index}`},
  kind: index % 2 === 0 ? "generation" : "tool",
  name: `step-${index}`,
  output: {text: `output ${index}`},
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
  usage: {costUsd: 0.01, inputTokens: 10, outputTokens: 20},
});

// Ten spans: a root with nested children, like a multi-stage agent trace.
const spans: TraceSpanNode[] = [
  buildSpan(0, [
    buildSpan(1, [buildSpan(2), buildSpan(3)]),
    buildSpan(4, [buildSpan(5), buildSpan(6), buildSpan(7)]),
    buildSpan(8),
    buildSpan(9),
  ]),
];

const detail: TraceDetail = {
  flaggedForDataset: false,
  id: "trace-1",
  name: "summarize",
  prompts: [],
  scoreCount: 2,
  scores: [
    {dataType: "boolean", name: "thumbs_up", source: "user-feedback", value: true},
    {comment: "ok", dataType: "numeric", name: "quality", source: "human", value: 4},
  ],
  sensitive: false,
  spanCount: 10,
  spans,
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
};
const handleBack = (): void => {};

describe("AiTraceDetailView renders", () => {
  it("re-renders only the two span rows whose selection changed", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiTraceDetailView detail={detail} onBack={handleBack} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => {
      view.rerender(<AiTraceDetailView detail={detail} onBack={handleBack} />);
    });
    await audit.step("new onBack identity", () => {
      view.rerender(<AiTraceDetailView detail={detail} onBack={(): void => {}} />);
    });
    await audit.step("select span", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-trace-span-span-5-clickable"));
      });
    });
    await audit.step("new equal detail", () => {
      view.rerender(<AiTraceDetailView detail={{...detail}} onBack={handleBack} />);
    });
    const report = audit.report();
    audit.dispose();
    expect(view.getByText("tool · step-5")).toBeTruthy();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiTraceDetailView\n${formatReport(report, {limit: 25})}`);
    }

    expect(componentStat(report, "mount", "SpanRow")?.mounts).toBe(10);
    expect(componentStat(report, "select span", "SpanRow")?.updates).toBe(2);
    for (const step of ["same props", "new onBack identity", "new equal detail"]) {
      expect(componentStat(report, step, "SpanRow")).toBeUndefined();
    }
  });
});
