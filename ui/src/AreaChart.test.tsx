import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";

import {AreaChart} from "./AreaChart";
import {renderWithTheme} from "./test-utils";

const POINTS = [
  {label: "A", value: 0},
  {label: "B", value: 50},
  {label: "C", value: 100},
];

const SERIES = [
  {data: POINTS, id: "current", label: "Current"},
  {
    data: POINTS.map((point) => ({...point, value: point.value / 2})),
    id: "previous",
    label: "Previous",
  },
];

describe("AreaChart", () => {
  it("applies explicit tick truncation and chart-card title", () => {
    const densePoints = Array.from({length: 10}, (_, index) => ({
      label: `Week ${index + 1}`,
      value: index + 1,
    }));
    const {getByTestId, getByText} = renderWithTheme(
      <AreaChart
        data={densePoints}
        periodLabel="Quarter to date"
        testID="chart"
        title="Revenue"
        xTickPolicy="truncate"
      />
    );
    const tickStyle = getByTestId("chart.xtick.0").props.style;
    const tickStyles = Array.isArray(tickStyle) ? tickStyle : [tickStyle];

    assert.isFalse(tickStyles.some((style) => Array.isArray(style?.transform)));
    assert.exists(getByText("Revenue"));
    assert.exists(getByText("Quarter to date"));
  });

  it("renders an area, line, and legend for each named series", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AreaChart data={[]} series={SERIES} testID="chart" />
    );

    for (let index = 0; index < SERIES.length; index += 1) {
      assert.exists(getByTestId(`chart.series.${index}.area`));
      assert.exists(getByTestId(`chart.series.${index}.path`));
      assert.exists(getByTestId(`chart.series.${index}.marker.0`));
      assert.exists(getByTestId(`chart.series.${index}.point.1-clickable`));
      assert.exists(getByTestId(`chart.legend.${index}`));
      assert.exists(getByText(SERIES[index]?.label ?? ""));
    }
  });

  it("renders a dotted comparison path on the shared scale", () => {
    const {getByTestId} = renderWithTheme(
      <AreaChart comparisonData={POINTS} data={POINTS} testID="chart" />
    );

    assert.isString(getByTestId("chart.comparison").props.strokeDasharray);
  });

  it("identifies the active series in a multi-series tooltip", async (): Promise<void> => {
    const {getByTestId, getByText} = renderWithTheme(
      <AreaChart data={[]} series={SERIES} testID="chart" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("chart.series.1.point.1-clickable"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.exists(getByText("Previous — B: 25"));
  });

  it("uses resolved comparison and empty-series data for its empty state", () => {
    const comparisonOnly = renderWithTheme(
      <AreaChart comparisonData={POINTS} data={[]} testID="comparison-chart" />
    );
    assert.exists(comparisonOnly.getByTestId("comparison-chart.comparison"));
    assert.notExists(comparisonOnly.queryByText("No data"));

    const allEmpty = renderWithTheme(
      <AreaChart data={POINTS} series={[{data: [], id: "empty", label: "Empty"}]} />
    );
    assert.exists(allEmpty.getByText("No data"));
  });

  it("renders one mark testID per point", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AreaChart data={POINTS} testID="chart" />
    );

    expect(getByTestId("chart.point.0-clickable")).toBeTruthy();
    expect(getByTestId("chart.point.1-clickable")).toBeTruthy();
    expect(getByTestId("chart.point.2-clickable")).toBeTruthy();
    expect(queryByTestId("chart.point.3-clickable")).toBeNull();
  });

  it("shows emptyText when data is empty", () => {
    const {getByText} = renderWithTheme(<AreaChart data={[]} emptyText="Nothing yet" />);

    expect(getByText("Nothing yet")).toBeTruthy();
  });

  it("shows tooltip copy after pressing a mark", async () => {
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <AreaChart data={POINTS} testID="chart" />
    );

    expect(queryByTestId("chart.tooltip")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("chart.point.1-clickable"));
    });

    expect(getByTestId("chart.tooltip")).toBeTruthy();
    expect(getByText("B: 50")).toBeTruthy();
  });

  it("updates or clears the active tooltip when data changes", async () => {
    const {getByTestId, getByText, queryByTestId, rerender} = renderWithTheme(
      <AreaChart data={POINTS} testID="chart" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("chart.point.1-clickable"));
    });
    rerender(
      <AreaChart
        data={[
          {label: "A", value: 0},
          {label: "B", value: 75},
        ]}
        testID="chart"
      />
    );
    expect(getByText("B: 75")).toBeTruthy();

    rerender(<AreaChart data={[{label: "A", value: 0}]} testID="chart" />);
    expect(queryByTestId("chart.tooltip")).toBeNull();
  });
});
