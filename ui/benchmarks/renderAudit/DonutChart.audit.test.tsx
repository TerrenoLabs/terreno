import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import type {DonutChartProps} from "../../src/Common";
import {DonutChart} from "../../src/DonutChart";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const makeData = (): DonutChartProps["data"] =>
  Array.from({length: 8}, (_, index) => ({label: `Slice ${index}`, value: index + 1}));
const data = makeData();
const formatValue = (value: number): string => `${value}`;
const baseline: DonutChartProps = {
  centerTitle: "Total",
  centerValue: "36",
  data,
  formatValue,
  testID: "donut",
  title: "Donut",
};

describe("DonutChart renders", () => {
  it("re-renders only the tooltip when a slice is hovered or pressed", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const view = await audit.step("mount", () => renderWithTheme(<DonutChart {...baseline} />));
    await audit.step("same props", () => view.rerender(<DonutChart {...baseline} />));
    await audit.step("new equal data", () =>
      view.rerender(<DonutChart {...baseline} data={makeData()} />)
    );
    view.rerender(<DonutChart {...baseline} />);
    await audit.step("new formatValue identity", () =>
      view.rerender(
        <DonutChart {...baseline} formatValue={(value: number): string => `${value}`} />
      )
    );
    view.rerender(<DonutChart {...baseline} />);
    await audit.step("press slice", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("donut.point.3-clickable"));
      });
    });
    await audit.step("press another slice", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("donut.point.5-clickable"));
      });
    });
    await audit.step("press same slice", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("donut.point.5-clickable"));
      });
    });
    const report = audit.report();
    audit.dispose();
    expect(view.getByTestId("donut.tooltip").props.children).toBe("Slice 5: 6");
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## DonutChart\n${formatReport(report)}`);
    }

    expect(componentStat(report, "mount", "DonutChartPlot")?.mounts).toBe(1);
    expect(componentStat(report, "press slice", "DonutChartPlot")).toBeUndefined();
    expect(componentStat(report, "press another slice", "DonutChart")?.updates).toBe(1);
    expect(componentStat(report, "press another slice", "DonutChartPlot")).toBeUndefined();
    expect(componentStat(report, "press same slice", "DonutChart")).toBeUndefined();
  });
});
