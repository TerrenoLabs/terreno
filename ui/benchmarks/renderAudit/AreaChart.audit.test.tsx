import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {AreaChart} from "../../src/AreaChart";
import type {AreaChartProps} from "../../src/Common";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const makePoints = (): {label: string; value: number}[] =>
  Array.from({length: 8}, (_, index) => ({label: `W${index}`, value: index * 10}));
const makeSeries = (): NonNullable<AreaChartProps["series"]> => [
  {data: makePoints(), id: "current", label: "Current"},
  {data: makePoints().map((p) => ({...p, value: p.value / 2})), id: "previous", label: "Previous"},
];
const series = makeSeries();
const data: AreaChartProps["data"] = [];
const formatValue = (value: number): string => `${value}`;
const baseline: AreaChartProps = {data, formatValue, series, testID: "chart", title: "Revenue"};

describe("AreaChart renders", () => {
  it("does not re-render when the active point is pressed again", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const view = await audit.step("mount", () => renderWithTheme(<AreaChart {...baseline} />));
    await audit.step("same props", () => view.rerender(<AreaChart {...baseline} />));
    await audit.step("new equal series", () =>
      view.rerender(<AreaChart {...baseline} series={makeSeries()} />)
    );
    view.rerender(<AreaChart {...baseline} />);
    await audit.step("new formatValue identity", () =>
      view.rerender(<AreaChart {...baseline} formatValue={(value: number): string => `${value}`} />)
    );
    view.rerender(<AreaChart {...baseline} />);
    await audit.step("press point", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("chart.series.0.point.3-clickable"));
      });
    });
    await audit.step("press another point", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("chart.series.1.point.5-clickable"));
      });
    });
    await audit.step("press same point", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("chart.series.1.point.5-clickable"));
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AreaChart\n${formatReport(report)}`);
    }

    expect(componentStat(report, "press another point", "AreaChart")?.updates).toBe(1);
    expect(componentStat(report, "press same point", "AreaChart")).toBeUndefined();
    expect(componentStat(report, "press same point", "ChartFrame")).toBeUndefined();
  });
});
