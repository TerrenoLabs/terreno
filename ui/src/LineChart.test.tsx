import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {LineChart} from "./LineChart";
import {renderWithTheme} from "./test-utils";

const POINTS = [
  {label: "A", value: 0},
  {label: "B", value: 50},
  {label: "C", value: 100},
];

describe("LineChart", () => {
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

  it("does not open URLs from x-axis labels", () => {
    const {getByText} = renderWithTheme(
      <LineChart data={[{label: "https://evil.example", value: 10}]} />
    );

    // The suite shares one Linking mock, so a spy on openURL also records calls
    // from other files. A label is inert when it has no press handler.
    expect(getByText("https://evil.example").props.onPress).toBeUndefined();
  });
});
