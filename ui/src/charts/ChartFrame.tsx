import {type FC, memo, type ReactNode} from "react";

import {Box} from "../Box";
import type {LoadingProps} from "../Common";
import {getLoadingAccessibilityProps, resolveLoadingContent} from "../Skeleton";
import {Spinner} from "../Spinner";
import {Text} from "../Text";
import {resolveTestID, toTestProps} from "../testing/resolveTestId";
import {CHART_FOOTER_ROW_HEIGHT} from "./layout";

export interface ChartFrameProps extends LoadingProps {
  accessibilityLabel?: string;
  children: ReactNode;
  emptyText: string;
  isEmpty: boolean;
  legendItems?: Array<{color: string; label: string}>;
  legendLabel?: string;
  testID?: string;
  tooltipText?: string;
}

const LEGEND_ITEM_STYLE = {__style: {flexBasis: 0, flexGrow: 1, flexShrink: 1}} as const;

interface ChartLegendItemProps {
  color: string;
  index: number;
  label: string;
  testID?: string;
}

// Memoized on primitives so a tooltip change while hovering the plot does not re-render the legend.
const ChartLegendItem: FC<ChartLegendItemProps> = memo(({color, index, label, testID}) => (
  <Box
    alignItems="center"
    dangerouslySetInlineStyle={LEGEND_ITEM_STYLE}
    direction="row"
    gap={1}
    minWidth={0}
    testID={resolveTestID(testID, `legend.${index}.item`)}
  >
    <Box
      dangerouslySetInlineStyle={{
        __style: {backgroundColor: color, height: 8, width: 8},
      }}
      testID={resolveTestID(testID, `legend.${index}.swatch`)}
    />
    <Text size="sm" skipLinking testID={resolveTestID(testID, `legend.${index}`)} truncate>
      {label}
    </Text>
  </Box>
));
ChartLegendItem.displayName = "ChartLegendItem";

export const ChartFrame: FC<ChartFrameProps> = ({
  accessibilityLabel,
  children,
  emptyText,
  isEmpty,
  legendItems,
  legendLabel,
  loading = false,
  loadingAnimation,
  loadingComponent,
  loadingLabel,
  testID,
  tooltipText,
}) => {
  const showPlot = !loading && !isEmpty;
  const loadingAccessibilityProps = getLoadingAccessibilityProps({loading, loadingLabel});

  // alignSelf stretch keeps the frame full width even when a parent centers its children, so the
  // measured plot width comes from the container instead of the chart's own content.
  return (
    <Box
      accessibilityLabel={loadingAccessibilityProps.accessibilityLabel ?? accessibilityLabel}
      accessibilityState={loadingAccessibilityProps.accessibilityState}
      alignSelf="stretch"
      minWidth={0}
      width="100%"
      {...toTestProps(testID)}
    >
      {resolveLoadingContent({
        defaultLoadingComponent: (
          <Box padding={4}>
            <Spinner testID={resolveTestID(testID, "spinner")} />
          </Box>
        ),
        loading,
        loadingAnimation,
        loadingComponent,
      })}
      {isEmpty && !loading ? <Text skipLinking>{emptyText}</Text> : null}
      {showPlot ? children : null}
      {showPlot ? (
        <Box height={CHART_FOOTER_ROW_HEIGHT} minWidth={0} overflow="hidden">
          {tooltipText ? (
            <Text size="sm" skipLinking testID={resolveTestID(testID, "tooltip")} truncate>
              {tooltipText}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {showPlot && legendItems && legendItems.length > 0 ? (
        <Box
          direction="row"
          gap={3}
          height={CHART_FOOTER_ROW_HEIGHT}
          minWidth={0}
          overflow="hidden"
        >
          {legendItems.map((item, index) => (
            <ChartLegendItem
              color={item.color}
              index={index}
              key={`${item.label}-${index}`}
              label={item.label}
              testID={testID}
            />
          ))}
        </Box>
      ) : null}
      {showPlot && (!legendItems || legendItems.length === 0) && legendLabel ? (
        <Box height={CHART_FOOTER_ROW_HEIGHT} minWidth={0} overflow="hidden">
          <Text size="sm" skipLinking testID={resolveTestID(testID, "legend")} truncate>
            {legendLabel}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
