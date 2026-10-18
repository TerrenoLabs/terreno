import {describe, it} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {assert} from "chai";

import {SparklineChart as RootSparklineChart} from "./index";
import {SparklineChart} from "./SparklineChart";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";

const CURRENT = [
  {label: "Mon", value: 12},
  {label: "Tue", value: 18},
  {label: "Wed", value: 9},
];

const COMPARISON = [
  {label: "Mon", value: 10},
  {label: "Tue", value: 11},
  {label: "Wed", value: 15},
];

const getPathXCoordinates = (path: string): number[] => {
  return Array.from(path.matchAll(/[ML]([0-9.]+),/g), (match) => Number(match[1]));
};

describe("SparklineChart", () => {
  it("renders current and dotted comparison paths without chart chrome", () => {
    const {getByTestId, queryByTestId, UNSAFE_queryAllByType} = renderWithTheme(
      <SparklineChart comparisonData={COMPARISON} data={CURRENT} testID="revenue-sparkline" />
    );

    const current = getByTestId("revenue-sparkline.current");
    const comparison = getByTestId("revenue-sparkline.comparison");

    assert.isUndefined(current.props.strokeDasharray);
    assert.isString(comparison.props.strokeDasharray);
    assert.deepEqual(getPathXCoordinates(current.props.d), getPathXCoordinates(comparison.props.d));
    assert.lengthOf(getPathXCoordinates(current.props.d), CURRENT.length);
    assert.lengthOf(UNSAFE_queryAllByType(Text), 0);
    assert.notExists(queryByTestId("revenue-sparkline.tooltip"));
    assert.notExists(queryByTestId("revenue-sparkline.legend"));
  });

  it("renders an empty frame without throwing", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SparklineChart data={[]} testID="empty-sparkline" />
    );

    assert.exists(getByTestId("empty-sparkline"));
    assert.notExists(queryByTestId("empty-sparkline.current"));
    assert.notExists(queryByTestId("empty-sparkline.comparison"));
  });

  it("is available from the package root lazy boundary", () => {
    assert.isFunction(RootSparklineChart);
  });

  it("redraws from the measured container width", () => {
    const {getByTestId} = renderWithTheme(
      <SparklineChart comparisonData={COMPARISON} data={CURRENT} testID="measured-sparkline" />
    );

    fireEvent(getByTestId("measured-sparkline"), "layout", {
      nativeEvent: {layout: {height: 48, width: 80}},
    });

    assert.exists(getByTestId("measured-sparkline.current"));
  });
});
