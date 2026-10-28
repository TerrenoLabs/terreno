import type {FC, ReactNode} from "react";
import {Children, isValidElement, useCallback, useState} from "react";

import {Box} from "./Box";
import type {DashboardGridItemProps, DashboardGridProps, LayoutChangeEvent} from "./Common";
import {getSpacing} from "./Common";
import {getDashboardSpanCellBoxStyle} from "./dashboardGridLayout";
import {useResponsiveBreakpoint} from "./ResponsiveBreakpoint";
import {resolveTestID} from "./testing/resolveTestId";

const DEFAULT_COLUMNS = {lg: 3, md: 2, sm: 1};

type MarkedDashboardGridItem = FC<DashboardGridItemProps> & {
  isDashboardGridItem?: boolean;
};

const resolveColumnCount = ({
  breakpoint,
  columns,
}: {
  breakpoint: "xs" | "sm" | "md" | "lg" | "xl";
  columns: {lg: number; md: number; sm: number};
}): number => {
  if (breakpoint === "lg" || breakpoint === "xl") {
    return columns.lg;
  }
  if (breakpoint === "md") {
    return columns.md;
  }
  return columns.sm;
};

const resolveItemSpan = ({
  breakpoint,
  span,
}: {
  breakpoint: "xs" | "sm" | "md" | "lg" | "xl";
  span?: DashboardGridItemProps["span"];
}): number => {
  if (!span) {
    return 1;
  }
  if (breakpoint === "lg" || breakpoint === "xl") {
    return span.lg ?? span.md ?? span.sm ?? 1;
  }
  if (breakpoint === "md") {
    return span.md ?? span.sm ?? 1;
  }
  return span.sm ?? 1;
};

export const DashboardGridItem: MarkedDashboardGridItem = ({children, testID}) => {
  return (
    <Box minWidth={0} testID={testID} width="100%">
      {children}
    </Box>
  );
};
DashboardGridItem.isDashboardGridItem = true;

const isDashboardGridItemType = (type: unknown): boolean => {
  if (typeof type === "function") {
    return (type as MarkedDashboardGridItem).isDashboardGridItem === true;
  }
  if (type && typeof type === "object" && "type" in type) {
    return isDashboardGridItemType(type.type);
  }
  return false;
};

export const DashboardGrid: FC<DashboardGridProps> = ({
  children,
  columns = DEFAULT_COLUMNS,
  gap = 4,
  testID,
}) => {
  const renderedChildren = Children.toArray(children);
  const breakpoint = useResponsiveBreakpoint({enabled: true});
  const [rowWidth, setRowWidth] = useState(0);
  const columnCount = Math.max(resolveColumnCount({breakpoint, columns}), 1);
  const gapPx = getSpacing(gap);

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0) {
      setRowWidth(nextWidth);
    }
  }, []);

  return (
    <Box direction="row" gap={gap} onLayout={handleLayout} testID={testID} width="100%" wrap>
      {renderedChildren.map((child: ReactNode, index: number) => {
        const itemSpan =
          isValidElement<DashboardGridItemProps>(child) && isDashboardGridItemType(child.type)
            ? child.props.span
            : undefined;
        const span = resolveItemSpan({breakpoint, span: itemSpan});
        const cellStyle = getDashboardSpanCellBoxStyle({
          columnCount,
          gapPx,
          rowWidth,
          span,
        });
        return (
          <Box
            dangerouslySetInlineStyle={{
              __style: cellStyle,
            }}
            key={`dashboard-cell-${index}`}
            testID={resolveTestID(testID, `cell.${index}`)}
          >
            {child}
          </Box>
        );
      })}
    </Box>
  );
};

export type {DashboardGridItemProps, DashboardGridProps} from "./Common";
