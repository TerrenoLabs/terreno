export const CHART_VISUAL_DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type ChartVisualDifficulty = (typeof CHART_VISUAL_DIFFICULTIES)[number];

export interface ChartVisualFixtureMeta {
  difficulty: ChartVisualDifficulty;
  id: string;
  title: string;
}

export const CHART_VISUAL_FIXTURES = [
  {difficulty: "easy", id: "line-three-points", title: "Line, three points"},
  {difficulty: "easy", id: "bar-three-points", title: "Bar, three points"},
  {difficulty: "easy", id: "area-three-points", title: "Area, three points"},
  {difficulty: "easy", id: "donut-three-slices", title: "Donut, three slices"},
  {difficulty: "easy", id: "line-empty", title: "Line, empty"},
  {difficulty: "medium", id: "line-legend-currency", title: "Line, legend and currency"},
  {difficulty: "medium", id: "bar-negatives-and-zero", title: "Bar, negatives and zero"},
  {difficulty: "medium", id: "donut-hex-override", title: "Donut, hex slice color"},
  {difficulty: "medium", id: "line-dense-labels", title: "Line, dense truncated labels"},
  {difficulty: "medium", id: "line-fixed-slot-140", title: "Line in a 140px slot"},
  {
    difficulty: "medium",
    id: "bar-time-rotated-ticks",
    title: "Time bars with rotated ticks",
  },
  {difficulty: "medium", id: "bar-day-of-week", title: "Day-of-week category bars"},
  {
    difficulty: "medium",
    id: "donut-center-and-share",
    title: "Donut center and share legend",
  },
  {difficulty: "medium", id: "donut-single-slice", title: "Donut single 100% slice"},
  {
    difficulty: "hard",
    id: "scorecard-sparkline-comparison",
    title: "Scorecards with comparison sparklines",
  },
  {difficulty: "hard", id: "line-three-series", title: "Three-series time line"},
  {
    difficulty: "hard",
    id: "hows-it-going-dashboard",
    title: "How's it going ops dashboard",
  },
  {difficulty: "hard", id: "dashboard-mixed-cards", title: "Dashboard grid of mixed charts"},
  {
    difficulty: "hard",
    id: "composed-product-card",
    title: "Composed card with heading, caption, and chart",
  },
  {
    difficulty: "hard",
    id: "ops-row-line-bar-donut",
    title: "Ops row: line, bar, and donut",
  },
] as const satisfies readonly ChartVisualFixtureMeta[];

export type ChartVisualFixtureId = (typeof CHART_VISUAL_FIXTURES)[number]["id"];

export const chartVisualFixtureTestId = (id: string): string => {
  return `chart-visual-${id}`;
};

export const CHART_VISUAL_GALLERY_TEST_ID = "chart-visual-gallery";
