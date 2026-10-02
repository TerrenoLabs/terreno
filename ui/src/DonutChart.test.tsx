import {describe, expect, it, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {Linking} from "react-native";

import {DonutChart} from "./DonutChart";
import {renderWithTheme} from "./test-utils";

const POINTS = [
  {label: "A", value: 50},
  {color: "#112233", label: "B", value: 50},
];

describe("DonutChart", () => {
  it("renders center copy and default percent shares in the legend", () => {
    const {getAllByText, getByTestId, getByText} = renderWithTheme(
      <DonutChart centerTitle="Cost" centerValue="$1.15K" data={POINTS} testID="chart" />
    );

    assert.exists(getByText("$1.15K"));
    assert.exists(getByText("Cost"));
    assert.exists(getByTestId("chart.center"));
    assert.exists(getByTestId("chart.center.value"));
    assert.exists(getByTestId("chart.center.title"));
    assert.equal(getByTestId("chart.share.0").props.children, "50%");
    assert.lengthOf(getAllByText("50%"), 2);
  });

  it("supports custom share formatting and a single 100% slice", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <DonutChart
        centerTitle="Conversions"
        centerValue="7.00"
        data={[{label: "Mobile phones", value: 7}]}
        formatShare={(value, total): string => `${value} of ${total}`}
        testID="chart"
      />
    );

    assert.isNotEmpty(getByTestId("chart.slice.0").props.d);
    assert.exists(getByText("7 of 7"));
    assert.exists(getByText("7.00"));
  });

  it("formats one full slice as 100% and zero totals as 0%", () => {
    const full = renderWithTheme(
      <DonutChart data={[{label: "Mobile phones", value: 7}]} testID="full-chart" />
    );
    assert.equal(full.getByTestId("full-chart.share.0").props.children, "100%");

    const emptyTotal = renderWithTheme(
      <DonutChart
        data={[
          {label: "A", value: 0},
          {label: "B", value: -1},
        ]}
        testID="zero-chart"
      />
    );
    assert.equal(emptyTotal.getByTestId("zero-chart.share.0").props.children, "0%");
    assert.equal(emptyTotal.getByTestId("zero-chart.share.1").props.children, "0%");
  });

  it("renders chart-card header shortcuts and omits them without title", async (): Promise<void> => {
    let pressCount = 0;
    const titled = renderWithTheme(
      <DonutChart
        data={POINTS}
        onPeriodPress={(): void => {
          pressCount += 1;
        }}
        periodLabel="Last 30 days"
        testID="chart"
        title="Cost by Device"
      />
    );
    assert.exists(titled.getByText("Cost by Device"));
    assert.exists(titled.getByText("Last 30 days"));
    fireEvent.press(titled.getByTestId("chart.card.period-clickable"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(pressCount, 1);

    const plain = renderWithTheme(<DonutChart data={POINTS} testID="plain-chart" />);
    assert.notExists(plain.queryByTestId("plain-chart.card"));
  });

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

  it("does not open URLs from slice legend labels", async () => {
    const openURLSpy = spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve(true));
    const {getByText} = renderWithTheme(
      <DonutChart data={[{label: "https://evil.example", value: 10}]} />
    );

    await act(async () => {
      fireEvent.press(getByText("https://evil.example"));
    });

    expect(openURLSpy).not.toHaveBeenCalled();
    openURLSpy.mockRestore();
  });
});
