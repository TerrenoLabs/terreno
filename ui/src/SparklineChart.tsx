import type {FC} from "react";
import {useCallback, useState} from "react";
import {Path, Svg} from "react-native-svg";

import {Box} from "./Box";
import type {LayoutChangeEvent, SparklineChartProps} from "./Common";
import {getLinePath} from "./charts/paths";
import {createCartesianScales} from "./charts/scales";
import {getChartPaint} from "./charts/theme";
import type {ChartPlot} from "./charts/types/chartTypes";
import {useTheme} from "./Theme";
import {resolveTestID, toTestProps} from "./testing/resolveTestId";

const DEFAULT_HEIGHT = 48;
const DEFAULT_WIDTH = 200;
const PLOT_INSET = 4;

export const SparklineChart: FC<SparklineChartProps> = ({
  accessibilityLabel = "Sparkline chart",
  comparisonData = [],
  data,
  height = DEFAULT_HEIGHT,
  testID,
}) => {
  const {theme} = useTheme();
  const paint = getChartPaint(theme);
  const [chartWidth, setChartWidth] = useState(DEFAULT_WIDTH);

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0) {
      setChartWidth(nextWidth);
    }
  }, []);

  const allPoints = [...data, ...comparisonData];
  const plot: ChartPlot = {
    height: Math.max(height - PLOT_INSET * 2, 1),
    left: PLOT_INSET,
    top: PLOT_INSET,
    width: Math.max(chartWidth - PLOT_INSET * 2, 1),
  };
  const scales = createCartesianScales({includeZero: false, plot, points: allPoints});
  const currentPath = getLinePath({points: data, scales});
  const comparisonPath = getLinePath({points: comparisonData, scales});

  return (
    <Box
      accessibilityLabel={accessibilityLabel}
      height={height}
      minWidth={0}
      onLayout={handleLayout}
      overflow="hidden"
      width="100%"
      {...toTestProps(testID)}
    >
      {allPoints.length > 0 ? (
        <Svg height={height} width={chartWidth}>
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
          {currentPath ? (
            <Path
              d={currentPath}
              fill="none"
              stroke={paint.series}
              strokeWidth={2}
              testID={resolveTestID(testID, "current")}
            />
          ) : null}
        </Svg>
      ) : null}
    </Box>
  );
};

export type {SparklineChartProps} from "./Common";
