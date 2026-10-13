import {describe, it} from "bun:test";
import {assert} from "chai";
import {Scorecard as RootScorecard} from "./index";
import {Scorecard} from "./Scorecard";
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

describe("Scorecard", () => {
  it("renders a formatted metric with current and comparison sparkline paths", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <Scorecard
        comparisonData={COMPARISON}
        formatValue={(value): string => `$${value}`}
        sparklineData={CURRENT}
        testID="cost-scorecard"
        title="Cost"
        value={569}
      />
    );

    assert.exists(getByText("Cost"));
    assert.exists(getByText("$569"));
    assert.exists(getByTestId("cost-scorecard.sparkline.current"));
    assert.exists(getByTestId("cost-scorecard.sparkline.comparison"));
  });

  it("renders a string metric without requiring sparkline data", () => {
    const {getByText, queryByTestId} = renderWithTheme(
      <Scorecard sparklineData={[]} testID="status-scorecard" title="Status" value="Healthy" />
    );

    assert.exists(getByText("Healthy"));
    assert.notExists(queryByTestId("status-scorecard.sparkline"));
  });

  it("uses default numeric formatting and omits comparison when it is not provided", () => {
    const {getByText, getByTestId, queryByTestId} = renderWithTheme(
      <Scorecard
        sparklineData={CURRENT}
        testID="conversion-scorecard"
        title="Conversions"
        value={7}
      />
    );

    assert.exists(getByText("7"));
    assert.exists(getByTestId("conversion-scorecard.sparkline.current"));
    assert.notExists(queryByTestId("conversion-scorecard.sparkline.comparison"));
  });

  it("is available from the package root lazy boundary", () => {
    assert.isFunction(RootScorecard);
  });
});
