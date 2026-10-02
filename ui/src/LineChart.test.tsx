import {describe, expect, it, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {Linking} from "react-native";

import {LineChart} from "./LineChart";
import {renderWithTheme} from "./test-utils";

const POINTS = [
  {label: "A", value: 0},
  {label: "B", value: 50},
  {label: "C", value: 100},
];

const SERIES = [
  {data: POINTS, id: "rank", label: "Search lost IS (rank)"},
  {
    data: POINTS.map((point) => ({...point, value: point.value / 2})),
    id: "share",
    label: "Search impr. share",
  },
  {
    data: POINTS.map((point) => ({...point, value: point.value / 4})),
    id: "budget",
    label: "Search lost IS (budget)",
  },
];

describe("LineChart", () => {
  it("applies explicit tick rotation and chart-card header shortcuts", async (): Promise<void> => {
    let pressCount = 0;
    const {getByTestId, getByText} = renderWithTheme(
      <LineChart
        data={POINTS}
        onPeriodPress={(): void => {
          pressCount += 1;
        }}
        periodLabel="Last 30 days"
        testID="chart"
        title="Search share"
        xTickPolicy="rotate"
      />
    );
    const tickStyle = getByTestId("chart.xtick.0").props.style;
    const tickStyles = Array.isArray(tickStyle) ? tickStyle : [tickStyle];

    assert.isTrue(tickStyles.some((style) => Array.isArray(style?.transform)));
    assert.exists(getByText("Search share"));
    assert.exists(getByText("Last 30 days"));
    fireEvent.press(getByTestId("chart.card.period-clickable"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(pressCount, 1);
  });

  it("renders one path and legend item per named series", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <LineChart data={[]} series={SERIES} testID="chart" />
    );

    for (let index = 0; index < SERIES.length; index += 1) {
      assert.exists(getByTestId(`chart.series.${index}.path`));
      assert.exists(getByTestId(`chart.series.${index}.marker.0`));
      assert.exists(getByTestId(`chart.legend.${index}`));
      assert.exists(getByTestId(`chart.legend.${index}.swatch`));
      const legendStyle = getByTestId(`chart.legend.${index}.item`).props.style;
      const legendStyles = Array.isArray(legendStyle) ? legendStyle : [legendStyle];
      assert.isTrue(
        legendStyles.some(
          (style: {flexGrow?: number; minWidth?: number} | undefined) =>
            style?.flexGrow === 1 && style.minWidth === 0
        )
      );
      assert.exists(getByText(SERIES[index]?.label ?? ""));
    }
    assert.isBelow(
      getByTestId("chart.series.0.marker.2").props.cy,
      getByTestId("chart.series.2.marker.2").props.cy
    );
  });

  it("identifies the active series in a multi-series tooltip", async (): Promise<void> => {
    const {getByTestId, getByText} = renderWithTheme(
      <LineChart data={[]} series={SERIES} testID="chart" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("chart.series.1.point.1-clickable"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.exists(getByText("Search impr. share — B: 25"));
  });

  it("renders a dotted comparison path on the shared scale", () => {
    const {getByTestId} = renderWithTheme(
      <LineChart comparisonData={POINTS} data={POINTS} testID="chart" />
    );

    assert.isString(getByTestId("chart.comparison").props.strokeDasharray);
  });

  it("renders comparison-only data instead of the empty state", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <LineChart comparisonData={POINTS} data={[]} testID="chart" />
    );

    assert.exists(getByTestId("chart.comparison"));
    assert.notExists(queryByText("No data"));
  });

  it("shows the empty state when every named series is empty", () => {
    const {getByText} = renderWithTheme(
      <LineChart data={POINTS} series={[{data: [], id: "empty", label: "Empty"}]} />
    );

    assert.exists(getByText("No data"));
  });

  it("renders one mark testID per point", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LineChart data={POINTS} testID="chart" />
    );

    expect(getByTestId("chart.point.0-clickable")).toBeTruthy();
    expect(getByTestId("chart.point.1-clickable")).toBeTruthy();
    expect(getByTestId("chart.point.2-clickable")).toBeTruthy();
    expect(queryByTestId("chart.point.3-clickable")).toBeNull();
  });

  it("forwards the chart summary accessibility label to the frame", () => {
    const {getByTestId} = renderWithTheme(
      <LineChart accessibilityLabel="Weekly signups chart" data={POINTS} testID="chart" />
    );

    expect(getByTestId("chart").props.accessibilityLabel).toBe("Weekly signups chart");
  });

  it("shows emptyText when data is empty", () => {
    const {getByText, queryByText} = renderWithTheme(
      <LineChart data={[]} emptyText="Nothing yet" />
    );

    expect(getByText("Nothing yet")).toBeTruthy();
    expect(queryByText("Line chart")).toBeNull();
  });

  it("shows the default empty copy", () => {
    const {getByText} = renderWithTheme(<LineChart data={[]} />);

    expect(getByText("No data")).toBeTruthy();
  });

  it("shows a spinner when loading and hides marks", async () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LineChart data={POINTS} loading testID="chart" />
    );

    expect(queryByTestId("chart.point.0-clickable")).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(getByTestId("chart.spinner")).toBeTruthy();
    expect(queryByTestId("chart.point.0-clickable")).toBeNull();
  });

  it("prefers loading over empty copy", async () => {
    const {queryByText, getByTestId} = renderWithTheme(
      <LineChart data={[]} emptyText="Nothing yet" loading testID="chart" />
    );

    expect(queryByText("Nothing yet")).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(getByTestId("chart.spinner")).toBeTruthy();
    expect(queryByText("Nothing yet")).toBeNull();
  });

  it("shows tooltip copy after pressing a mark", async () => {
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <LineChart data={POINTS} testID="chart" />
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
      <LineChart data={POINTS} testID="chart" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("chart.point.1-clickable"));
    });
    rerender(
      <LineChart
        data={[
          {label: "A", value: 0},
          {label: "B", value: 75},
        ]}
        testID="chart"
      />
    );
    expect(getByText("B: 75")).toBeTruthy();

    rerender(<LineChart data={[{label: "A", value: 0}]} testID="chart" />);
    expect(queryByTestId("chart.tooltip")).toBeNull();
  });

  it("renders the legend label", () => {
    const {getByText} = renderWithTheme(<LineChart data={POINTS} legendLabel="Sales" />);

    expect(getByText("Sales")).toBeTruthy();
  });

  it("resizes the plot to a measured container narrower than the default width", async () => {
    const {getByTestId} = renderWithTheme(<LineChart data={POINTS} testID="chart" />);

    await act(async () => {
      fireEvent(getByTestId("chart.plot"), "layout", {
        nativeEvent: {layout: {height: 200, width: 120}},
      });
    });

    const markStyle = getByTestId("chart.point.2-clickable").props.style;
    const styles = Array.isArray(markStyle) ? markStyle : [markStyle];
    const positioned = styles.find(
      (entry: {left?: number} | undefined) => typeof entry?.left === "number"
    ) as {left: number};

    expect(positioned.left).toBeLessThan(120);
  });

  it("keeps x-axis labels absolutely positioned so a long label cannot widen the chart", () => {
    const {getByTestId} = renderWithTheme(
      <LineChart data={[{label: "A very long axis label", value: 10}]} testID="chart" />
    );
    const slotStyle = getByTestId("chart.xtick.0").props.style;
    const styles = Array.isArray(slotStyle) ? slotStyle : [slotStyle];

    expect(styles).toEqual(
      expect.arrayContaining([expect.objectContaining({position: "absolute"})])
    );
  });

  it("does not open URLs from x-axis labels", async () => {
    const openURLSpy = spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve(true));
    const {getByText} = renderWithTheme(
      <LineChart data={[{label: "https://evil.example", value: 10}]} />
    );

    await act(async () => {
      fireEvent.press(getByText("https://evil.example"));
    });

    expect(openURLSpy).not.toHaveBeenCalled();
    openURLSpy.mockRestore();
  });
});
