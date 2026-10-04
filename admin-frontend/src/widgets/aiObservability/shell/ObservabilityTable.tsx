import {Box, Text} from "@terreno/ui";
import React from "react";
import {View, type ViewStyle} from "react-native";

export interface ObservabilityTableColumn {
  /** Relative share of leftover row width. */
  grow?: number;
  /** Floor for the column width. */
  minWidth?: number;
  title: string;
}

export interface ObservabilityTableRow {
  accessibilityLabel?: string;
  cells: React.ReactNode[];
  key: string;
  onClick?: () => void;
}

export interface ObservabilityTableProps {
  columns: ObservabilityTableColumn[];
  rows: ObservabilityTableRow[];
  testID: string;
}

const DEFAULT_MIN_WIDTH = 120;
const CELL_LINES = 3;

/** Share column width in a row without `Box flex="grow"` (`display: flex`), which can stretch row height in scroll pages. */
const columnCellStyle = (minWidth: number, grow = 1): ViewStyle => ({
  flexBasis: 0,
  flexGrow: grow,
  flexShrink: 1,
  minWidth,
});

const renderRowCells = ({
  columns,
  row,
}: {
  columns: ObservabilityTableColumn[];
  row: ObservabilityTableRow;
}): React.ReactNode[] => {
  return row.cells.map((cell, cellIndex) => {
    const column = columns[cellIndex];
    const minWidth = column?.minWidth ?? DEFAULT_MIN_WIDTH;
    return (
      <View
        key={column?.title ?? `cell-${cellIndex}`}
        style={columnCellStyle(minWidth, column?.grow)}
      >
        {typeof cell === "string" || typeof cell === "number" ? (
          <Text numberOfLines={CELL_LINES}>{cell}</Text>
        ) : (
          cell
        )}
      </View>
    );
  });
};

/**
 * Flow-height table for the observability screens. `DataTable` sizes itself to a
 * height-constrained parent and clips fixed-width cells, so inside these scrolling pages its rows
 * overlap and long JSON values are cut mid-line. These rows grow with their content and wrap cell
 * text over a few lines before truncating.
 */
export const ObservabilityTable: React.FC<ObservabilityTableProps> = ({columns, rows, testID}) => {
  return (
    <Box
      alignSelf="start"
      border="default"
      direction="column"
      rounding="md"
      testID={testID}
      width="100%"
    >
      <Box alignItems="start" direction="row" gap={3} paddingX={3} paddingY={2}>
        {columns.map((column) => {
          const minWidth = column.minWidth ?? DEFAULT_MIN_WIDTH;
          return (
            <View key={column.title} style={columnCellStyle(minWidth, column.grow)}>
              <Text bold size="sm">
                {column.title}
              </Text>
            </View>
          );
        })}
      </Box>
      {rows.map((row) => {
        const cells = renderRowCells({columns, row});
        if (row.onClick) {
          return (
            <Box
              accessibilityHint="Open full row details"
              accessibilityLabel={row.accessibilityLabel ?? "Open row details"}
              accessibilityRole="button"
              alignItems="start"
              borderTop="default"
              direction="row"
              gap={3}
              key={row.key}
              onClick={row.onClick}
              paddingX={3}
              paddingY={2}
              testID={`${testID}-row-${row.key}`}
            >
              {cells}
            </Box>
          );
        }
        return (
          <Box
            alignItems="start"
            borderTop="default"
            direction="row"
            gap={3}
            key={row.key}
            paddingX={3}
            paddingY={2}
            testID={`${testID}-row-${row.key}`}
          >
            {cells}
          </Box>
        );
      })}
    </Box>
  );
};
