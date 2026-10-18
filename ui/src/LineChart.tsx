import type {FC} from "react";
import {useCallback, useState} from "react";
import {Circle, Path, Svg, Line as SvgLine} from "react-native-svg";

import {Box} from "./Box";
import type {LayoutChangeEvent, LineChartProps} from "./Common";
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
import {getLinePath} from "./charts/paths";
import {createCartesianScales, getYTickValues} from "./charts/scales";
import {getAllSeriesPoints, getAxisPoints, resolveChartSeries} from "./charts/series";
import {getChartPaint} from "./charts/theme";
import type {ChartPoint} from "./charts/types/chartTypes";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveTestID} from "./testing/resolveTestId";

const DEFAULT_HEIGHT = 200;
const DEFAULT_WIDTH = 300;
const MARK_HIT_SIZE = 24;

const formatChartTooltip = ({
  formatValue,
  point,
  seriesLabel,
}: {
  formatValue: (value: number) => string;
  point: ChartPoint;
  seriesLabel?: string;
}): string => {
  const prefix = seriesLabel ? `${seriesLabel} — ` : "";
  return `${prefix}${point.label}: ${formatValue(point.value)}`;
};

interface ActivePoint {
  pointIndex: number;
  seriesIndex: number;
}

export const LineChart: FC<LineChartProps> = ({
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
  const [activePoint, setActivePoint] = useState<ActivePoint | undefined>(undefined);

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0) {
      setChartWidth(nextWidth);
    }
  }, []);

  const handleMarkPress = useCallback((seriesIndex: number, pointIndex: number): void => {
    setActivePoint({pointIndex, seriesIndex});
  }, []);

  const resolvedSeries = resolveChartSeries({data, legendLabel, series});
  const allPoints = getAllSeriesPoints({comparisonData, series: resolvedSeries});
  const axisPoints = getAxisPoints({comparisonData, series: resolvedSeries});
  const coloredSeries = resolvedSeries.map((entry, index) => ({
    ...entry,
    color: entry.color ?? paint.slices[index % paint.slices.length] ?? paint.series,
  }));
  const axisWidth = getChartAxisWidth(chartWidth);
  const legendItems =
    series && series.length > 0
      ? coloredSeries.map((entry) => ({color: entry.color, label: entry.label}))
      : undefined;
  const isXTickRotated = shouldRotateChartXTicks({
    labelCount: axisPoints.length,
    policy: xTickPolicy,
  });
  const xAxisHeight = isXTickRotated ? CHART_ROTATED_X_AXIS_HEIGHT : CHART_X_AXIS_HEIGHT;
  const plotHeight = getPlotHeight({
    hasLegend: Boolean(legendLabel) || Boolean(legendItems?.length),
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
  const comparisonPath = getLinePath({points: comparisonData, scales});
  const yTicks = getYTickValues(allPoints);
  const activeSeries = activePoint ? coloredSeries[activePoint.seriesIndex] : undefined;
  const selectedPoint = activePoint ? activeSeries?.data[activePoint.pointIndex] : undefined;
  const tooltipText = selectedPoint
    ? formatChartTooltip({
        formatValue,
        point: selectedPoint,
        seriesLabel: series && series.length > 0 ? activeSeries?.label : undefined,
      })
    : undefined;
  const summaryLabel =
    accessibilityLabel ?? (legendLabel ? `${legendLabel} line chart` : "Line chart");

  const chart = (
    <ChartFrame
      accessibilityLabel={summaryLabel}
      emptyText={emptyText}
      isEmpty={allPoints.length === 0}
      legendItems={legendItems}
      legendLabel={legendLabel}
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
              {comparisonPath ? (
                <Path
                  d={comparisonPath}
                  fill="none"
                  opacity={0.6}
                  stroke={paint.series}
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  testID={resolveTestID(testID, "comparison")}
                />
              ) : null}
              {coloredSeries.map((entry, seriesIndex) => {
                const linePath = getLinePath({points: entry.data, scales});
                return linePath ? (
                  <Path
                    d={linePath}
                    fill="none"
                    key={`line-${entry.id}`}
                    stroke={entry.color}
                    strokeDasharray={entry.stroke === "dotted" ? "4 4" : undefined}
                    strokeWidth={2}
                    testID={resolveTestID(testID, `series.${seriesIndex}.path`)}
                  />
                ) : null;
              })}
              {coloredSeries.flatMap((entry, seriesIndex) =>
                entry.data.map((point, pointIndex) => (
                  <Circle
                    cx={scales.xCenter(point.label)}
                    cy={scales.y(point.value)}
                    fill={entry.color}
                    key={`dot-${entry.id}-${point.label}`}
                    r={4}
                    testID={resolveTestID(testID, `series.${seriesIndex}.marker.${pointIndex}`)}
                  />
                ))
              )}
            </Svg>
            {coloredSeries.flatMap((entry, seriesIndex) =>
              entry.data.map((point, pointIndex) => {
                const onPress = (): void => {
                  handleMarkPress(seriesIndex, pointIndex);
                };
                const markTestID =
                  series && series.length > 0
                    ? `series.${seriesIndex}.point.${pointIndex}`
                    : `point.${pointIndex}`;
                return (
                  <Box
                    accessibilityHint={`Show value for ${point.label}`}
                    accessibilityLabel={
                      series && series.length > 0
                        ? `${entry.label} — ${point.label}: ${formatValue(point.value)}`
                        : `${point.label}: ${formatValue(point.value)}`
                    }
                    dangerouslySetInlineStyle={{
                      __style: {
                        height: MARK_HIT_SIZE,
                        left: scales.xCenter(point.label) - MARK_HIT_SIZE / 2,
                        position: "absolute",
                        top: scales.y(point.value) - MARK_HIT_SIZE / 2,
                        width: MARK_HIT_SIZE,
                      },
                    }}
                    key={`mark-${entry.id}-${point.label}`}
                    onClick={onPress}
                    onHoverStart={onPress}
                    testID={resolveTestID(testID, markTestID)}
                  />
                );
              })
            )}
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

export type {LineChartProps} from "./Common";
export type {ChartPoint, ChartSeries} from "./charts/types/chartTypes";
