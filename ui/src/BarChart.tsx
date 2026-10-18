import type {FC} from "react";
import {useCallback, useState} from "react";
import {Rect, Svg, Line as SvgLine} from "react-native-svg";

import {Box} from "./Box";
import type {BarChartProps, LayoutChangeEvent} from "./Common";
import {getBarLayout} from "./charts/bars";
import {ChartFacadeContainer} from "./charts/ChartFacadeContainer";
import {ChartFrame} from "./charts/ChartFrame";
import {
  CHART_ROTATED_X_AXIS_HEIGHT,
  CHART_X_AXIS_HEIGHT,
  getChartAxisWidth,
  getChartPlot,
  getPlotHeight,
  getXTickStyle,
  getYTickStyle,
  shouldRotateChartXTicks,
} from "./charts/layout";
import {createCartesianScales, getYTickValues} from "./charts/scales";
import {getAxisPoints} from "./charts/series";
import {getChartPaint} from "./charts/theme";
import type {ChartPoint} from "./charts/types/chartTypes";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveTestID} from "./testing/resolveTestId";

const DEFAULT_HEIGHT = 200;
const DEFAULT_WIDTH = 300;
const BAR_FILL = 0.7;

const formatChartTooltip = ({
  formatValue,
  point,
}: {
  formatValue: (value: number) => string;
  point: ChartPoint;
}): string => {
  return `${point.label}: ${formatValue(point.value)}`;
};

export const BarChart: FC<BarChartProps> = ({
  accessibilityLabel,
  comparisonData = [],
  data,
  emptyText = "No data",
  formatValue = String,
  height = DEFAULT_HEIGHT,
  legendLabel,
  loading = false,
  onPeriodPress,
  periodLabel,
  series,
  testID,
  title,
  xTickPolicy = "auto",
}) => {
  const {theme} = useTheme();
  const paint = getChartPaint(theme);
  const [chartWidth, setChartWidth] = useState(DEFAULT_WIDTH);
  const [activePointIndex, setActivePointIndex] = useState<number | undefined>(undefined);

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0) {
      setChartWidth(nextWidth);
    }
  }, []);

  const handleMarkPress = useCallback((pointIndex: number): void => {
    setActivePointIndex(pointIndex);
  }, []);

  const primarySeries = series && series.length > 0 ? series[0] : undefined;
  const chartData = primarySeries?.data ?? data;
  const seriesColor = primarySeries?.color ?? paint.series;
  const effectiveLegendLabel = primarySeries?.label ?? legendLabel;
  const axisPoints = getAxisPoints({
    comparisonData,
    series: [
      {data: chartData, id: primarySeries?.id ?? "default", label: effectiveLegendLabel ?? ""},
    ],
  });
  const allPoints = [...chartData, ...comparisonData];
  const isXTickRotated = shouldRotateChartXTicks({
    labelCount: axisPoints.length,
    policy: xTickPolicy,
  });
  const xAxisHeight = isXTickRotated ? CHART_ROTATED_X_AXIS_HEIGHT : CHART_X_AXIS_HEIGHT;
  const axisWidth = getChartAxisWidth(chartWidth);
  const plotHeight = getPlotHeight({
    hasLegend: Boolean(effectiveLegendLabel),
    height,
    xAxisHeight,
  });
  const plot = getChartPlot({chartWidth, height: plotHeight});
  const plotWidth = chartWidth - axisWidth;
  const scales = createCartesianScales({
    plot,
    points: allPoints,
    xLabels: axisPoints.map((point) => point.label),
  });
  const yTicks = getYTickValues(allPoints);
  const baselineY = scales.y(0);
  const barWidth = Math.max(scales.bandwidth * BAR_FILL, 1);
  const comparisonBarWidth = Math.max(scales.bandwidth * 0.9, 1);
  const activePoint = activePointIndex === undefined ? undefined : chartData[activePointIndex];
  const tooltipText = activePoint
    ? formatChartTooltip({formatValue, point: activePoint})
    : undefined;
  const summaryLabel =
    accessibilityLabel ??
    (effectiveLegendLabel ? `${effectiveLegendLabel} bar chart` : "Bar chart");

  const chart = (
    <ChartFrame
      accessibilityLabel={summaryLabel}
      emptyText={emptyText}
      isEmpty={allPoints.length === 0}
      legendLabel={effectiveLegendLabel}
      loading={loading}
      testID={testID}
      tooltipText={tooltipText}
    >
      <Box minWidth={0} onLayout={handleLayout} testID={resolveTestID(testID, "plot")} width="100%">
        <Box direction="row" height={plotHeight}>
          <Box height={plotHeight} position="relative" width={axisWidth}>
            {yTicks.map((tick) => (
              <Box
                dangerouslySetInlineStyle={{__style: getYTickStyle({axisWidth, y: scales.y(tick)})}}
                key={`ytick-${tick}`}
              >
                <Text align="right" color="secondaryDark" size="sm" skipLinking truncate>
                  {formatValue(tick)}
                </Text>
              </Box>
            ))}
          </Box>
          <Box flex="grow" height={plotHeight} minWidth={0} overflow="hidden" position="relative">
            <Svg height={plotHeight} width={plotWidth}>
              {yTicks.map((tick) => {
                const y = scales.y(tick);
                return (
                  <SvgLine
                    key={`grid-${tick}`}
                    stroke={paint.grid}
                    strokeWidth={1}
                    x1={plot.left}
                    x2={plot.left + plot.width}
                    y1={y}
                    y2={y}
                  />
                );
              })}
              {comparisonData.map((point, index) => {
                const layout = getBarLayout({
                  barWidth: comparisonBarWidth,
                  baselineY,
                  value: point.value,
                  xCenter: scales.xCenter(point.label),
                  y: scales.y,
                });
                if (layout.height === 0) {
                  return null;
                }
                return (
                  <Rect
                    fill={seriesColor}
                    height={layout.height}
                    key={`comparison-${point.label}`}
                    opacity={0.3}
                    testID={resolveTestID(testID, `comparison.${index}`)}
                    width={layout.width}
                    x={layout.x}
                    y={layout.y}
                  />
                );
              })}
              {chartData.map((point, index) => {
                const layout = getBarLayout({
                  barWidth,
                  baselineY,
                  value: point.value,
                  xCenter: scales.xCenter(point.label),
                  y: scales.y,
                });
                if (layout.height === 0) {
                  return null;
                }
                return (
                  <Rect
                    fill={point.color ?? seriesColor}
                    height={layout.height}
                    key={`bar-${point.label}`}
                    testID={resolveTestID(testID, `current.${index}`)}
                    width={layout.width}
                    x={layout.x}
                    y={layout.y}
                  />
                );
              })}
            </Svg>
            {chartData.map((point, index) => {
              const onPress = (): void => {
                handleMarkPress(index);
              };
              const layout = getBarLayout({
                barWidth,
                baselineY,
                value: point.value,
                xCenter: scales.xCenter(point.label),
                y: scales.y,
              });
              return (
                <Box
                  accessibilityHint={`Show value for ${point.label}`}
                  accessibilityLabel={`${point.label}: ${formatValue(point.value)}`}
                  dangerouslySetInlineStyle={{
                    __style: {
                      height: layout.hitHeight,
                      left: layout.hitX,
                      position: "absolute",
                      top: layout.hitY,
                      width: layout.hitWidth,
                    },
                  }}
                  key={`mark-${point.label}`}
                  onClick={onPress}
                  onHoverStart={onPress}
                  testID={resolveTestID(testID, `point.${index}`)}
                />
              );
            })}
          </Box>
        </Box>
        <Box direction="row">
          <Box width={axisWidth} />
          <Box flex="grow" height={xAxisHeight} minWidth={0} overflow="hidden" position="relative">
            {axisPoints.map((point, index) => (
              <Box
                dangerouslySetInlineStyle={{
                  __style: getXTickStyle({
                    bandwidth: scales.bandwidth,
                    isRotated: isXTickRotated,
                    xCenter: scales.xCenter(point.label),
                  }),
                }}
                key={`xtick-${point.label}`}
                testID={resolveTestID(testID, `xtick.${index}`)}
              >
                <Text
                  align="center"
                  color="secondaryDark"
                  numberOfLines={1}
                  size="sm"
                  skipLinking
                  truncate={!isXTickRotated}
                >
                  {point.label}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </ChartFrame>
  );

  return (
    <ChartFacadeContainer
      onPeriodPress={onPeriodPress}
      periodLabel={periodLabel}
      testID={testID}
      title={title}
    >
      {chart}
    </ChartFacadeContainer>
  );
};

export type {BarChartProps} from "./Common";
export type {ChartPoint} from "./charts/types/chartTypes";
