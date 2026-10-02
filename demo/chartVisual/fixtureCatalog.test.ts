import {describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {assert} from "chai";

import {
  CHART_VISUAL_DIFFICULTIES,
  CHART_VISUAL_FIXTURES,
  chartVisualFixtureTestId,
} from "./fixtureCatalog";

describe("chart visual fixture catalog", () => {
  it("keeps unique ids in easy-to-hard order", () => {
    const ids = CHART_VISUAL_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(12);

    const rank = (difficulty: (typeof CHART_VISUAL_DIFFICULTIES)[number]): number => {
      return CHART_VISUAL_DIFFICULTIES.indexOf(difficulty);
    };
    const ranks = CHART_VISUAL_FIXTURES.map((fixture) => rank(fixture.difficulty));
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index] ?? 0).toBeGreaterThanOrEqual(ranks[index - 1] ?? 0);
    }
    for (const id of ids) {
      assert.isTrue(existsSync(join(import.meta.dir, `../rendered-snapshots/${id}.png`)));
    }
  });

  it("uses a stable test id prefix for Playwright", () => {
    expect(chartVisualFixtureTestId("line-three-points")).toBe("chart-visual-line-three-points");
  });

  it("registers the scorecard comparison fixture as a hard visual", () => {
    const fixture = CHART_VISUAL_FIXTURES.find(
      (entry) => entry.id === "scorecard-sparkline-comparison"
    );

    assert.exists(fixture);
    assert.equal(fixture.difficulty, "hard");
    assert.equal(
      chartVisualFixtureTestId(fixture.id),
      "chart-visual-scorecard-sparkline-comparison"
    );
    assert.isTrue(
      existsSync(join(import.meta.dir, "../rendered-snapshots/scorecard-sparkline-comparison.png"))
    );
  });

  it("registers the cartesian parity fixtures", () => {
    const expectedIds = ["bar-time-rotated-ticks", "line-three-series", "bar-day-of-week"];

    for (const id of expectedIds) {
      assert.exists(CHART_VISUAL_FIXTURES.find((fixture) => fixture.id === id));
      assert.isTrue(existsSync(join(import.meta.dir, `../rendered-snapshots/${id}.png`)));
    }
  });

  it("registers the donut center fixtures and goldens", () => {
    const expectedIds = ["donut-center-and-share", "donut-single-slice"];

    for (const id of expectedIds) {
      assert.exists(CHART_VISUAL_FIXTURES.find((fixture) => fixture.id === id));
      assert.isTrue(existsSync(join(import.meta.dir, `../rendered-snapshots/${id}.png`)));
    }
  });

  it("registers the How's it going dashboard fixture and golden", () => {
    const fixture = CHART_VISUAL_FIXTURES.find((entry) => entry.id === "hows-it-going-dashboard");

    assert.exists(fixture);
    assert.equal(fixture.difficulty, "hard");
    assert.isTrue(
      existsSync(join(import.meta.dir, "../rendered-snapshots/hows-it-going-dashboard.png"))
    );
  });
});
