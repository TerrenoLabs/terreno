import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {BarChart} from "../../src/BarChart";
import type {BarChartProps} from "../../src/Common";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const makePoints = (): {label: string; value: number}[] =>
  Array.from({length: 8}, (_, index) => ({label: `W${index}`, value: (index + 1) * 10}));
const data = makePoints();
const comparisonData = makePoints().map((point) => ({...point, value: point.value / 2}));
const formatValue = (value: number): string => `${value}`;
const baseline: BarChartProps = {
  comparisonData,
  data,
  formatValue,
  legendLabel: "Revenue",
  testID: "chart",
  title: "Revenue",
};

describe("BarChart renders", () => {
  it("keeps the plot still when a bar is hovered or pressed", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const view = await audit.step("mount", () => renderWithTheme(<BarChart {...baseline} />));
    await audit.step("same props", () => view.rerender(<BarChart {...baseline} />));
    await audit.step("new equal data", () =>
      view.rerender(<BarChart {...baseline} data={makePoints()} />)
    );
    view.rerender(<BarChart {...baseline} />);
    await audit.step("new formatValue identity", () =>
      view.rerender(<BarChart {...baseline} formatValue={(value: number): string => `${value}`} />)
    );
    view.rerender(<BarChart {...baseline} />);
    await audit.step("press point", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("chart.point.3-clickable"));
      });
    });
    await audit.step("press another point", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("chart.point.5-clickable"));
      });
    });
    await audit.step("press same point", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("chart.point.5-clickable"));
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## BarChart\n${formatReport(report)}`);
    }
    expect(componentStat(report, "same props", "BarChartPlot")).toBeUndefined();
    expect(componentStat(report, "press point", "BarChart")?.updates).toBe(1);
    expect(componentStat(report, "press point", "BarChartPlot")).toBeUndefined();
    expect(componentStat(report, "press another point", "BarChartPlot")).toBeUndefined();
    expect(componentStat(report, "press another point", "Pressable")).toBeUndefined();
    expect(componentStat(report, "press same point", "BarChart")).toBeUndefined();
  });
});
