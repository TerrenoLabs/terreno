import {describe, expect, it} from "bun:test";
import {assert} from "chai";
import type React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import ChartVisualGalleryPage from "../app/demo/chart-visual-gallery";

import {ChartVisualGallery} from "./ChartVisualGallery";
import type {ChartVisualFixtureId} from "./fixtureCatalog";
import {CHART_VISUAL_FIXTURES, CHART_VISUAL_GALLERY_TEST_ID} from "./fixtureCatalog";
import {renderChartVisualFixture} from "./fixtures";

const Host: React.FC<{id: ChartVisualFixtureId}> = ({id}) => {
  return renderChartVisualFixture(id);
};

describe("chart visual fixtures", () => {
  it("renders the full visual gallery", () => {
    const {getByTestId} = renderWithTheme(<ChartVisualGallery />);

    expect(getByTestId(CHART_VISUAL_GALLERY_TEST_ID)).toBeTruthy();
  });

  it("renders the Expo Router gallery page", () => {
    const {getByTestId} = renderWithTheme(<ChartVisualGalleryPage />);

    expect(getByTestId(CHART_VISUAL_GALLERY_TEST_ID)).toBeTruthy();
  });

  for (const fixture of CHART_VISUAL_FIXTURES) {
    it(`renders ${fixture.id} without throwing`, () => {
      expect(() => {
        renderWithTheme(<Host id={fixture.id} />);
      }).not.toThrow();
    });
  }

  it("renders five current/comparison scorecard pairs", async (): Promise<void> => {
    const {findByTestId} = renderWithTheme(<Host id="scorecard-sparkline-comparison" />);

    for (let index = 0; index < 5; index += 1) {
      assert.exists(await findByTestId(`scorecard-fixture.${index}.sparkline.current`));
      assert.exists(await findByTestId(`scorecard-fixture.${index}.sparkline.comparison`));
    }
  });

  it("binds cartesian parity fixture ids to their intended paint behavior", async (): Promise<void> => {
    const timeBars = renderWithTheme(<Host id="bar-time-rotated-ticks" />);
    const timeTickStyle = (await timeBars.findByTestId("bar-time-rotated-ticks.xtick.0")).props
      .style;
    const timeTickStyles = Array.isArray(timeTickStyle) ? timeTickStyle : [timeTickStyle];
    assert.isTrue(timeTickStyles.some((style) => Array.isArray(style?.transform)));

    const weekdayBars = renderWithTheme(<Host id="bar-day-of-week" />);
    const weekdayTickStyle = (await weekdayBars.findByTestId("bar-day-of-week.xtick.0")).props
      .style;
    const weekdayTickStyles = Array.isArray(weekdayTickStyle)
      ? weekdayTickStyle
      : [weekdayTickStyle];
    assert.isFalse(weekdayTickStyles.some((style) => Array.isArray(style?.transform)));

    const threeLines = renderWithTheme(<Host id="line-three-series" />);
    for (let index = 0; index < 3; index += 1) {
      assert.exists(await threeLines.findByTestId(`line-three-series.series.${index}.path`));
      assert.exists(await threeLines.findByTestId(`line-three-series.legend.${index}`));
    }
  });

  it("binds donut parity fixtures to center copy and share legends", async (): Promise<void> => {
    const shared = renderWithTheme(<Host id="donut-center-and-share" />);
    assert.equal(
      (await shared.findByTestId("donut-center-and-share.center.value")).props.children,
      "$1.15K"
    );
    assert.equal(
      (await shared.findByTestId("donut-center-and-share.center.title")).props.children,
      "Cost"
    );
    assert.equal(
      (await shared.findByTestId("donut-center-and-share.share.0")).props.children,
      "80%"
    );
    assert.equal(
      (await shared.findByTestId("donut-center-and-share.share.1")).props.children,
      "20%"
    );

    const single = renderWithTheme(<Host id="donut-single-slice" />);
    assert.isNotEmpty((await single.findByTestId("donut-single-slice.slice.0")).props.d);
    assert.equal((await single.findByTestId("donut-single-slice.share.0")).props.children, "100%");
    assert.equal(
      (await single.findByTestId("donut-single-slice.center.value")).props.children,
      "7.00"
    );
    assert.equal(
      (await single.findByTestId("donut-single-slice.center.title")).props.children,
      "Conversions"
    );
  });

  it("composes the How's it going dashboard from spanning grid regions", async (): Promise<void> => {
    const dashboard = renderWithTheme(<Host id="hows-it-going-dashboard" />);

    assert.exists(await dashboard.findByTestId("hows-it-going-dashboard.kpis"));
    assert.exists(await dashboard.findByTestId("hows-it-going-dashboard.table-placeholder"));
    assert.exists(await dashboard.findByTestId("hows-it-going-dashboard.time-charts"));
    assert.exists(await dashboard.findByTestId("hows-it-going-dashboard.bottom-table-placeholder"));
    assert.lengthOf(await dashboard.findAllByText("DataTable lands in Task 5.2"), 2);
    assert.exists(await dashboard.findByText("Cost / conv. over time"));
    assert.exists(await dashboard.findByText("Imp. share over time"));
    assert.exists(await dashboard.findByText("Conversions by Device"));
  });
});
