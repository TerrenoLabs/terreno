import {describe, it} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {assert} from "chai";

import {ChartCard} from "./ChartCard";
import {ChartCard as RootChartCard} from "./index";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";

describe("ChartCard", () => {
  it("renders title, filter summary, period badge, and children", () => {
    const {getByText} = renderWithTheme(
      <ChartCard
        filterSummary="Report filters: status is Eligible"
        periodLabel="Last 30 days"
        title="Cost by Device"
      >
        <Text>Chart body</Text>
      </ChartCard>
    );

    assert.exists(getByText("Cost by Device"));
    assert.exists(getByText("Report filters: status is Eligible"));
    assert.exists(getByText("Last 30 days"));
    assert.exists(getByText("Chart body"));
  });

  it("makes the period badge pressable only when a handler is provided", async (): Promise<void> => {
    let pressCount = 0;
    const handlePeriodPress = (): void => {
      pressCount += 1;
    };
    const interactive = renderWithTheme(
      <ChartCard
        onPeriodPress={handlePeriodPress}
        periodLabel="Last 14 days"
        testID="cost-card"
        title="Cost"
      >
        <Text>Body</Text>
      </ChartCard>
    );

    const periodButton = interactive.getByTestId("cost-card.period-clickable");
    assert.equal(periodButton.props.accessibilityRole, "button");
    assert.equal(periodButton.props["aria-label"], "Last 14 days");
    assert.equal(periodButton.props.accessibilityHint, "Change reporting period");
    fireEvent.press(periodButton);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(pressCount, 1);

    const displayOnly = renderWithTheme(
      <ChartCard periodLabel="Previous period" testID="display-card" title="Cost">
        <Text>Body</Text>
      </ChartCard>
    );
    assert.notExists(displayOnly.queryByTestId("display-card.period-clickable"));
    assert.notEqual(
      displayOnly.getByTestId("display-card.period").props.accessibilityRole,
      "button"
    );
  });

  it("omits optional period and filter chrome", () => {
    const {queryByTestId, queryByText} = renderWithTheme(
      <ChartCard testID="plain-card" title="Conversions">
        <Text>Body</Text>
      </ChartCard>
    );

    assert.notExists(queryByTestId("plain-card.period"));
    assert.notExists(queryByTestId("plain-card.filter-summary"));
    assert.notExists(queryByText("Last 30 days"));
  });

  it("is available from the package root lazy boundary", () => {
    assert.isFunction(RootChartCard);
  });
});
