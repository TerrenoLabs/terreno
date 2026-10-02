import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {DonutChart} from "./DonutChart";
import {renderWithTheme} from "./test-utils";

const POINTS = [
  {label: "A", value: 50},
  {color: "#112233", label: "B", value: 50},
];

describe("DonutChart", () => {
  it("renders one mark testID per slice", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DonutChart data={POINTS} testID="chart" />
    );

    expect(getByTestId("chart.point.0-clickable")).toBeTruthy();
    expect(getByTestId("chart.point.1-clickable")).toBeTruthy();
    expect(queryByTestId("chart.point.2-clickable")).toBeNull();
  });

  it("applies a per-slice color override on the legend swatch", () => {
    const {getByTestId} = renderWithTheme(<DonutChart data={POINTS} testID="chart" />);
    const swatchStyle = getByTestId("chart.swatch.1").props.style;
    const styles = Array.isArray(swatchStyle) ? swatchStyle : [swatchStyle];

    expect(styles).toEqual(
      expect.arrayContaining([expect.objectContaining({backgroundColor: "#112233"})])
    );
  });

  it("shows emptyText when data is empty", () => {
    const {getByText} = renderWithTheme(<DonutChart data={[]} emptyText="Nothing yet" />);

    expect(getByText("Nothing yet")).toBeTruthy();
  });

  it("renders a legend row per slice and ignores legendLabel", () => {
    const {getByText, queryByText} = renderWithTheme(
      <DonutChart data={POINTS} legendLabel="Should hide" />
    );

    expect(getByText("A")).toBeTruthy();
    expect(getByText("B")).toBeTruthy();
    expect(queryByText("Should hide")).toBeNull();
  });

  it("puts each quarter slice hit in the quadrant that slice paints", () => {
    const quarters = [
      {label: "A", value: 25},
      {label: "B", value: 25},
      {label: "C", value: 25},
      {label: "D", value: 25},
    ];
    const {getByTestId} = renderWithTheme(
      <DonutChart data={quarters} height={220} testID="chart" />
    );
    const positionOf = (index: number): {left: number; top: number} => {
      const markStyle = getByTestId(`chart.point.${index}-clickable`).props.style;
      const styles = Array.isArray(markStyle) ? markStyle : [markStyle];
      return styles.find(
        (entry: {left?: number; top?: number} | undefined) =>
          typeof entry?.left === "number" && typeof entry?.top === "number"
      ) as {left: number; top: number};
    };

    // The first quarter paints 12–3 o'clock, so its hit sits up and to the right of the third
    // quarter, which paints 6–9 o'clock.
    expect(positionOf(0).left).toBeGreaterThan(positionOf(2).left);
    expect(positionOf(0).top).toBeLessThan(positionOf(2).top);
  });

  it("shows tooltip copy after pressing a slice mark", async () => {
    const {getByTestId, getByText} = renderWithTheme(<DonutChart data={POINTS} testID="chart" />);

    await act(async () => {
      fireEvent.press(getByTestId("chart.point.1-clickable"));
    });

    expect(getByText("B: 50")).toBeTruthy();
  });

  it("updates or clears the active tooltip when data changes", async () => {
    const {getByTestId, getByText, queryByTestId, rerender} = renderWithTheme(
      <DonutChart data={POINTS} testID="chart" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("chart.point.1-clickable"));
    });
    rerender(
      <DonutChart
        data={[
          {label: "A", value: 25},
          {label: "B", value: 75},
        ]}
        testID="chart"
      />
    );
    expect(getByText("B: 75")).toBeTruthy();

    rerender(<DonutChart data={[{label: "A", value: 100}]} testID="chart" />);
    expect(queryByTestId("chart.tooltip")).toBeNull();
  });

  it("does not open URLs from slice legend labels", () => {
    const {getByText} = renderWithTheme(
      <DonutChart data={[{label: "https://evil.example", value: 10}]} />
    );

    // The suite shares one Linking mock, so a spy on openURL also records calls
    // from other files. A label is inert when it has no press handler.
    expect(getByText("https://evil.example").props.onPress).toBeUndefined();
  });
});
