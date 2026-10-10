import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {DateTime} from "luxon";
import type React from "react";
import {
  type FC,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  type FlatList as RNFlatList,
  ScrollView,
  View,
} from "react-native";
import {Box} from "./Box";
import {Button} from "./Button";
import type {
  ColumnSortInterface,
  DataTableCellData,
  DataTableCellProps,
  DataTableColumn,
  DataTableCustomComponentMap,
  DataTableProps,
  SurfaceColor,
} from "./Common";
import {readableTextColor} from "./colorContrast";
import {DataTableHeaderInfoMarkdown} from "./DataTableHeaderInfoMarkdown";
import {
  DataTableAdditionalFiltersWeb,
  DataTableColumnFilterWeb,
  DataTableFilterFields,
} from "./dataTableFilters";
import {buildDataTableListQuery, DATA_TABLE_SEARCH_DEBOUNCE_MS} from "./dataTableListQuery";
import {FlatList} from "./FlatList";
import {Icon} from "./Icon";
import {InfoModalIcon} from "./InfoModalIcon";
import {Modal} from "./Modal";
import {Pagination} from "./Pagination";
import {Text} from "./Text";
import {TextField} from "./TextField";
import {useTheme} from "./Theme";
import {TableTitle} from "./table/TableTitle";
import {
  resolveDataTableRowTestID,
  resolveDataTableTestIDsFromProps,
  toTestProps,
} from "./testing/resolveTestId";

// TODO: Add permanent horizontal scroll bar so users with only a mouse can scroll left/right
// easily.

const DATA_TABLE_INITIAL_NUM_TO_RENDER = 15;
const DATA_TABLE_MAX_TO_RENDER_PER_BATCH = 10;
const DATA_TABLE_WINDOW_SIZE = 5;
const DATA_TABLE_VERTICAL_SCROLL_SYNC_RELEASE_MS = 50;

const TextCell: FC<{
  cellData: DataTableCellData;
  column: DataTableColumn;
}> = ({cellData}) => {
  const {theme} = useTheme();
  const highlightColor = cellData.highlight ? theme.surface[cellData.highlight] : undefined;
  const textColor =
    highlightColor &&
    readableTextColor(theme.text.primary, theme.text.inverted, highlightColor) === "inverted"
      ? "inverted"
      : undefined;

  return (
    <Box flex="grow" justifyContent="center">
      <Text color={textColor} size={cellData.textSize || "md"}>
        {String(cellData.value ?? "")}
      </Text>
    </Box>
  );
};

const NumberCell: FC<{
  cellData: DataTableCellData;
  column: DataTableColumn;
}> = ({cellData}) => {
  return (
    <Box flex="grow" justifyContent="center" width="100%">
      <Text align="right" size={cellData.textSize || "md"}>
        {String(cellData.value ?? "")}
      </Text>
    </Box>
  );
};

/** Formats ISO strings and Dates as Luxon DATE_MED; anything unparseable is shown as written. */
const formatDataTableDate = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  let date: DateTime | undefined;
  if (value instanceof Date) {
    date = DateTime.fromJSDate(value);
  } else if (typeof value === "string") {
    date = DateTime.fromISO(value);
  }
  if (!date?.isValid) {
    return String(value);
  }
  return date.toLocaleString(DateTime.DATE_MED);
};

const DateCell: FC<{
  cellData: DataTableCellData;
  column: DataTableColumn;
}> = ({cellData}) => {
  return (
    <Box flex="grow" justifyContent="center">
      <Text size={cellData.textSize || "md"}>{formatDataTableDate(cellData.value)}</Text>
    </Box>
  );
};

const CheckedCell: FC<{
  cellData: DataTableCellData;
  column: DataTableColumn;
}> = ({cellData}) => {
  const isChecked = Boolean(cellData.value);
  return (
    <Box flex="grow" justifyContent="center" width="100%">
      <Icon color={isChecked ? "success" : "secondaryDark"} iconName={isChecked ? "check" : "x"} />
    </Box>
  );
};

interface InternalDataTableCellProps extends Omit<DataTableCellProps, "columnWidths"> {
  pinnedLeft: number;
}

const DataTableCellComponent: FC<InternalDataTableCellProps> = ({
  value,
  columnDef,
  colIndex,
  isPinnedHorizontal,
  pinnedColumns,
  pinnedLeft,
  customColumnComponentMap,
  backgroundColor,
  height,
  textSize = "md",
}) => {
  const {theme} = useTheme();
  const isLastPinnedColumn = isPinnedHorizontal && colIndex === pinnedColumns - 1;

  // Default to TextCell
  let Component: React.ComponentType<{
    column: DataTableColumn;
    cellData: DataTableCellData;
  }> = TextCell;
  if (customColumnComponentMap?.[columnDef.columnType]) {
    Component = customColumnComponentMap[columnDef.columnType];
  } else if (columnDef.columnType === "boolean") {
    Component = CheckedCell;
  } else if (columnDef.columnType === "number") {
    Component = NumberCell;
  } else if (columnDef.columnType === "date") {
    Component = DateCell;
  }
  const cellData = value.textSize === textSize ? value : {...value, textSize};

  return (
    <View
      style={{
        backgroundColor,
        borderBottomColor: theme.border.default,
        borderBottomWidth: 1,
        height,
        justifyContent: "center",
        overflow: "hidden",
        padding: 16,
        position: "relative",
        width: columnDef.width,
        zIndex: 1,
        // For pinned columns: use absolute positioning to stay fixed while scrolling horizontally
        ...(isPinnedHorizontal && {
          left: pinnedLeft,
          position: "absolute",
          // Higher z-index keeps pinned columns above scrollable ones, decreasing by column index
          zIndex: 10 - colIndex,
        }),
        // Visual separator after last pinned column
        ...(isLastPinnedColumn && {
          borderRightColor: theme.border.default,
          borderRightWidth: 3,
        }),
      }}
    >
      <Component cellData={cellData} column={columnDef} />
    </View>
  );
};

const DataTableCell = memo(DataTableCellComponent);

interface DataTableRowProps {
  rowData: DataTableCellData[];
  rowIndex: number;
  columns: DataTableColumn[];
  columnEnd: number;
  columnStart: number;
  pinnedColumns: number;
  pinnedLeftOffsets: number[];
  alternateRowBackground: boolean;
  customColumnComponentMap?: DataTableCustomComponentMap;
  defaultTextSize: "sm" | "md" | "lg";
  rowHeight: number;
  testID?: string;
}

const DataTableRowComponent: FC<DataTableRowProps> = ({
  rowData,
  rowIndex,
  columns,
  columnEnd,
  columnStart,
  pinnedColumns,
  pinnedLeftOffsets,
  alternateRowBackground,
  customColumnComponentMap,
  defaultTextSize,
  rowHeight,
  testID,
}) => {
  const {theme} = useTheme();
  const backgroundColor =
    alternateRowBackground && rowIndex % 2 === 1 ? theme.surface.neutralLight : theme.surface.base;

  return (
    <View
      style={{
        borderBottomColor: theme.border.default,
        borderBottomWidth: 1,
        flexDirection: "row",
        height: rowHeight,
      }}
      {...toTestProps(testID)}
    >
      {rowData.slice(columnStart, columnEnd).map((cell, relativeColumnIndex) => {
        const columnIndex = columnStart + relativeColumnIndex;
        return (
          <DataTableCell
            backgroundColor={
              cell.highlight ? theme.surface[cell.highlight as SurfaceColor] : backgroundColor
            }
            colIndex={columnIndex}
            columnDef={columns[columnIndex]}
            customColumnComponentMap={customColumnComponentMap}
            height={rowHeight}
            isPinnedHorizontal={columnIndex < pinnedColumns}
            key={columnIndex}
            pinnedColumns={pinnedColumns}
            pinnedLeft={pinnedLeftOffsets[columnIndex] ?? 0}
            textSize={cell.textSize ?? defaultTextSize}
            value={cell}
          />
        );
      })}
    </View>
  );
};

DataTableRowComponent.displayName = "DataTableRow";

const DataTableRow = memo(DataTableRowComponent);

interface MoreButtonCellProps {
  rowIndex: number;
  alternateRowBackground: boolean;
  onClick: (rowIndex: number) => void;
  column: DataTableColumn;
  rowHeight: number;
}

const MoreButtonCellComponent: FC<MoreButtonCellProps> = ({
  rowIndex,
  alternateRowBackground,
  onClick,
  rowHeight,
}) => {
  const {theme} = useTheme();

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor:
          alternateRowBackground && rowIndex % 2 === 1
            ? theme.surface.neutralLight
            : theme.surface.base,
        borderBottomColor: theme.border.default,
        borderBottomWidth: 1,
        height: rowHeight ?? 54,
        justifyContent: "center",
        width: 48,
      }}
    >
      <Pressable
        accessibilityHint="View details"
        accessibilityLabel="Open modal"
        accessibilityRole="button"
        onPress={() => onClick(rowIndex)}
        style={{
          alignItems: "center",
          backgroundColor:
            alternateRowBackground && rowIndex % 2 === 1
              ? theme.surface.base
              : theme.surface.neutralLight,
          borderRadius: theme.radius.rounded,
          height: 32,
          justifyContent: "center",
          width: 32,
        }}
      >
        <Icon color="secondaryDark" iconName="info" size="md" />
      </Pressable>
    </View>
  );
};

const MoreButtonCell = memo(MoreButtonCellComponent);

interface DataTableHeaderCellProps {
  column: DataTableColumn;
  index: number;
  isPinnedHorizontal: boolean;
  isPinnedRow?: boolean;
  pinnedLeft: number;
  sortColumn?: ColumnSortInterface;
  onSort: (index: number) => void;
  rowHeight: number;
  headerHeight?: number;
  filterValues?: Record<string, unknown>;
  onFilterValuesChange?: (next: Record<string, unknown>) => void;
}

const DataTableHeaderCell: FC<DataTableHeaderCellProps> = ({
  column,
  filterValues,
  index,
  isPinnedHorizontal,
  onFilterValuesChange,
  pinnedLeft,
  sortColumn,
  onSort,
  rowHeight,
  headerHeight,
}) => {
  const {theme} = useTheme();
  const sort = sortColumn?.column === index ? sortColumn.direction : undefined;
  // Number cells are right-aligned, so their header sits on the same edge.
  const isNumberColumn = column.columnType === "number";

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: theme.surface.base,
        borderBottomColor: theme.border.default,
        borderBottomWidth: 1,
        flexDirection: "row",
        height: headerHeight ?? rowHeight,
        justifyContent: isNumberColumn ? "flex-end" : "space-between",
        padding: 16,
        width: column.width,
        ...(isPinnedHorizontal && {
          left: pinnedLeft,
          position: "absolute",
          zIndex: 10 - index,
        }),
      }}
    >
      {[
        column.title ? (
          <TableTitle
            align={isNumberColumn ? "right" : "left"}
            key="data-table-header-title"
            title={column.title!}
          />
        ) : null,
        <View key="data-table-header-tools" style={{alignItems: "center", flexDirection: "row"}}>
          {column.filter && onFilterValuesChange && Platform.OS === "web" ? (
            <DataTableColumnFilterWeb
              appliedValues={filterValues ?? {}}
              columnTitle={column.title}
              filter={column.filter}
              onApply={onFilterValuesChange}
              testID={`data-table-filter-${column.filter.field}`}
            />
          ) : null}
          {column.infoModalText && (
            <InfoModalIcon
              infoModalChildren={
                <DataTableHeaderInfoMarkdown>{column.infoModalText}</DataTableHeaderInfoMarkdown>
              }
            />
          )}
          {column.sortable && (
            <Pressable hitSlop={16} onPress={() => onSort(index)}>
              <View
                style={{
                  alignItems: "center",
                  backgroundColor: sort ? theme.surface.primary : theme.surface.neutralLight,
                  borderRadius: theme.radius.rounded,
                  height: 16,
                  justifyContent: "center",
                  marginLeft: 8,
                  width: 16,
                }}
              >
                <FontAwesome6
                  color={theme.text.inverted}
                  name={
                    sort === "asc" ? "arrow-down" : sort === "desc" ? "arrow-up" : "arrows-up-down"
                  }
                  selectable={undefined}
                  size={10}
                  solid
                />
              </View>
            </Pressable>
          )}
        </View>,
      ]}
    </View>
  );
};

interface DataTableHeaderProps {
  columns: DataTableColumn[];
  hasMoreContent: boolean;
  pinnedColumns: number;
  pinnedLeftOffsets: number[];
  pinnedWidth: number;
  headerScrollRef: React.RefObject<ScrollView | null>;
  sortColumn?: ColumnSortInterface;
  onSort: (index: number) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>, isHeader: boolean) => void;
  rowHeight: number;
  headerHeight?: number;
  testID?: string;
  filterValues?: Record<string, unknown>;
  onFilterValuesChange?: (next: Record<string, unknown>) => void;
}

const DataTableHeader: FC<DataTableHeaderProps> = ({
  columns,
  filterValues,
  hasMoreContent,
  onFilterValuesChange,
  pinnedColumns,
  pinnedLeftOffsets,
  pinnedWidth,
  headerScrollRef,
  sortColumn,
  onSort,
  onScroll,
  rowHeight,
  headerHeight,
  testID,
}) => {
  const {theme} = useTheme();

  return (
    <View style={{flexDirection: "row", position: "relative"}} testID={testID}>
      {/* Fixed-width container for "more" content button if present */}
      {hasMoreContent && (
        <View
          style={{
            backgroundColor: theme.surface.base,
            borderBottomColor: theme.border.default,
            borderBottomWidth: 1,
            height: headerHeight ?? rowHeight,
            width: 48,
            zIndex: 11,
          }}
        />
      )}

      {/* Container for pinned header columns - stays fixed during horizontal scroll */}
      {pinnedColumns > 0 && (
        <View
          style={{
            // Offset left position if there's a "more" content button
            left: hasMoreContent ? 48 : 0,
            position: "absolute",
            top: 0,
            zIndex: 10,
          }}
        >
          {columns.slice(0, pinnedColumns).map((column, index) => (
            <DataTableHeaderCell
              column={column}
              filterValues={filterValues}
              headerHeight={headerHeight}
              index={index}
              isPinnedHorizontal
              key={`pinned-header-${index}`}
              onFilterValuesChange={onFilterValuesChange}
              onSort={onSort}
              pinnedLeft={pinnedLeftOffsets[index] ?? 0}
              rowHeight={rowHeight}
              sortColumn={sortColumn}
            />
          ))}
        </View>
      )}

      {/* Scrollable container for non-pinned header columns */}
      <ScrollView
        horizontal
        onScroll={(e) => onScroll(e, true)}
        ref={headerScrollRef}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={{
          // Offset scrollable area by total width of pinned columns
          marginLeft: pinnedWidth,
        }}
      >
        {columns.slice(pinnedColumns).map((column, index) => (
          <DataTableHeaderCell
            column={column}
            filterValues={filterValues}
            headerHeight={headerHeight}
            index={index + pinnedColumns}
            isPinnedHorizontal={false}
            key={`scrollable-header-${index + pinnedColumns}`}
            onFilterValuesChange={onFilterValuesChange}
            onSort={onSort}
            pinnedLeft={0}
            rowHeight={rowHeight}
            sortColumn={sortColumn}
          />
        ))}
      </ScrollView>
    </View>
  );
};

interface DataTableContentProps {
  data: DataTableCellData[][];
  columns: DataTableColumn[];
  pinnedColumns: number;
  alternateRowBackground: boolean;
  pinnedLeftOffsets: number[];
  pinnedWidth: number;
  bodyScrollRef: React.RefObject<ScrollView | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>, isHeader: boolean) => void;
  moreContentComponent?: React.ComponentType<
    {
      column: DataTableColumn;
      rowData: DataTableCellData[];
      rowIndex: number;
    } & Record<string, unknown>
  >;
  // Extra props to pass to the more modal, one per row.
  moreContentExtraData?: Record<string, unknown>[];
  moreContentSize?: "sm" | "md" | "lg";
  customColumnComponentMap?: DataTableCustomComponentMap;
  defaultTextSize: "sm" | "md" | "lg";
  rowHeight: number;
  rowTestIdBase?: string;
  getRowTestID?: (row: DataTableCellData[], rowIndex: number) => string | number;
}

const DataTableContentComponent: FC<DataTableContentProps> = ({
  data,
  columns,
  pinnedColumns,
  alternateRowBackground,
  pinnedLeftOffsets,
  pinnedWidth,
  bodyScrollRef,
  onScroll,
  customColumnComponentMap,
  moreContentComponent: MoreContentContent,
  moreContentExtraData,
  moreContentSize = "md",
  defaultTextSize,
  rowHeight,
  rowTestIdBase,
  getRowTestID,
}) => {
  const [modalRow, setModalRow] = useState<number | null>(null);
  const {theme} = useTheme();
  const bodyListRef = useRef<RNFlatList<DataTableCellData[]>>(null);
  const pinnedListRef = useRef<RNFlatList<DataTableCellData[]>>(null);
  const moreListRef = useRef<RNFlatList<DataTableCellData[]>>(null);
  const bodyScrollYRef = useRef(0);
  const isVerticalScrollSyncingRef = useRef(false);
  const verticalScrollLeaderRef = useRef<"body" | "pinned" | "more" | null>(null);
  const verticalScrollSyncReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moreColumnOffset = MoreContentContent ? 48 : 0;
  const scrollableWidth = useMemo(
    () => columns.slice(pinnedColumns).reduce((sum, column) => sum + column.width, 0),
    [columns, pinnedColumns]
  );

  const resolveRowTestId = useCallback(
    (row: DataTableCellData[], rowIndex: number): string | undefined => {
      const rowKey = getRowTestID ? getRowTestID(row, rowIndex) : rowIndex;
      return resolveDataTableRowTestID(rowTestIdBase, rowKey);
    },
    [getRowTestID, rowTestIdBase]
  );

  const getRowItemLayout = useCallback(
    (_: ArrayLike<DataTableCellData[]> | null | undefined, index: number) => ({
      index,
      length: rowHeight,
      offset: rowHeight * index,
    }),
    [rowHeight]
  );

  const keyExtractor = useCallback((_: DataTableCellData[], index: number) => String(index), []);

  const listExtraData = useMemo(
    () => ({
      alternateRowBackground,
      columns,
      customColumnComponentMap,
      defaultTextSize,
      pinnedColumns,
      pinnedLeftOffsets,
      rowHeight,
    }),
    [
      alternateRowBackground,
      columns,
      customColumnComponentMap,
      defaultTextSize,
      pinnedColumns,
      pinnedLeftOffsets,
      rowHeight,
    ]
  );

  const applyVerticalScrollToFollowers = useCallback(
    (scrollY: number, source: "body" | "pinned" | "more"): void => {
      if (source !== "body") {
        bodyListRef.current?.scrollToOffset({animated: false, offset: scrollY});
      }
      if (source !== "pinned") {
        pinnedListRef.current?.scrollToOffset({animated: false, offset: scrollY});
      }
      if (source !== "more") {
        moreListRef.current?.scrollToOffset({animated: false, offset: scrollY});
      }
    },
    []
  );

  const scheduleVerticalScrollSyncRelease = useCallback((): void => {
    if (verticalScrollSyncReleaseTimeoutRef.current) {
      clearTimeout(verticalScrollSyncReleaseTimeoutRef.current);
    }
    verticalScrollSyncReleaseTimeoutRef.current = setTimeout(() => {
      isVerticalScrollSyncingRef.current = false;
      verticalScrollLeaderRef.current = null;
      verticalScrollSyncReleaseTimeoutRef.current = null;
    }, DATA_TABLE_VERTICAL_SCROLL_SYNC_RELEASE_MS);
  }, []);

  const syncVerticalScroll = useCallback(
    (scrollY: number, source: "body" | "pinned" | "more"): void => {
      if (isVerticalScrollSyncingRef.current) {
        if (source !== verticalScrollLeaderRef.current) {
          return;
        }
        applyVerticalScrollToFollowers(scrollY, source);
        scheduleVerticalScrollSyncRelease();
        return;
      }
      isVerticalScrollSyncingRef.current = true;
      verticalScrollLeaderRef.current = source;
      applyVerticalScrollToFollowers(scrollY, source);
      scheduleVerticalScrollSyncRelease();
    },
    [applyVerticalScrollToFollowers, scheduleVerticalScrollSyncRelease]
  );

  const syncSatelliteListsToBodyOffset = useCallback((): void => {
    const scrollY = bodyScrollYRef.current;
    if (scrollY <= 0) {
      return;
    }
    if (pinnedColumns === 0 && !MoreContentContent) {
      return;
    }
    isVerticalScrollSyncingRef.current = true;
    verticalScrollLeaderRef.current = "body";
    if (pinnedColumns > 0) {
      pinnedListRef.current?.scrollToOffset({animated: false, offset: scrollY});
    }
    if (MoreContentContent) {
      moreListRef.current?.scrollToOffset({animated: false, offset: scrollY});
    }
    scheduleVerticalScrollSyncRelease();
  }, [MoreContentContent, pinnedColumns, scheduleVerticalScrollSyncRelease]);

  // Pinned/more FlatLists mount at offset 0; align them with the body list's current scroll position.
  useLayoutEffect(() => {
    syncSatelliteListsToBodyOffset();
    return () => {
      if (verticalScrollSyncReleaseTimeoutRef.current) {
        clearTimeout(verticalScrollSyncReleaseTimeoutRef.current);
        verticalScrollSyncReleaseTimeoutRef.current = null;
      }
      isVerticalScrollSyncingRef.current = false;
      verticalScrollLeaderRef.current = null;
    };
  }, [syncSatelliteListsToBodyOffset]);

  const handleBodyVerticalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const scrollY = event.nativeEvent.contentOffset.y;
      bodyScrollYRef.current = scrollY;
      syncVerticalScroll(scrollY, "body");
    },
    [syncVerticalScroll]
  );

  const handlePinnedVerticalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const scrollY = event.nativeEvent.contentOffset.y;
      bodyScrollYRef.current = scrollY;
      syncVerticalScroll(scrollY, "pinned");
    },
    [syncVerticalScroll]
  );

  const handleMoreVerticalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const scrollY = event.nativeEvent.contentOffset.y;
      bodyScrollYRef.current = scrollY;
      syncVerticalScroll(scrollY, "more");
    },
    [syncVerticalScroll]
  );

  const renderMoreRow = useCallback(
    ({index}: {index: number}) => (
      <MoreButtonCell
        alternateRowBackground={alternateRowBackground}
        column={columns[0]}
        onClick={setModalRow}
        rowHeight={rowHeight}
        rowIndex={index}
      />
    ),
    [alternateRowBackground, columns, rowHeight]
  );

  const renderPinnedRow = useCallback(
    ({index, item}: {index: number; item: DataTableCellData[]}) => (
      <DataTableRow
        alternateRowBackground={alternateRowBackground}
        columnEnd={pinnedColumns}
        columnStart={0}
        columns={columns}
        customColumnComponentMap={customColumnComponentMap}
        defaultTextSize={defaultTextSize}
        pinnedColumns={pinnedColumns}
        pinnedLeftOffsets={pinnedLeftOffsets}
        rowData={item}
        rowHeight={rowHeight}
        rowIndex={index}
        testID={pinnedColumns > 0 ? resolveRowTestId(item, index) : undefined}
      />
    ),
    [
      alternateRowBackground,
      columns,
      customColumnComponentMap,
      defaultTextSize,
      pinnedColumns,
      pinnedLeftOffsets,
      resolveRowTestId,
      rowHeight,
    ]
  );

  const renderScrollableRow = useCallback(
    ({index, item}: {index: number; item: DataTableCellData[]}) => (
      <DataTableRow
        alternateRowBackground={alternateRowBackground}
        columnEnd={columns.length}
        columnStart={pinnedColumns}
        columns={columns}
        customColumnComponentMap={customColumnComponentMap}
        defaultTextSize={defaultTextSize}
        pinnedColumns={0}
        pinnedLeftOffsets={pinnedLeftOffsets}
        rowData={item}
        rowHeight={rowHeight}
        rowIndex={index}
        testID={pinnedColumns === 0 ? resolveRowTestId(item, index) : undefined}
      />
    ),
    [
      alternateRowBackground,
      columns,
      customColumnComponentMap,
      defaultTextSize,
      pinnedColumns,
      pinnedLeftOffsets,
      resolveRowTestId,
      rowHeight,
    ]
  );

  return (
    <>
      <View style={{flex: 1, flexDirection: "row", position: "relative"}}>
        {Boolean(MoreContentContent) && (
          <View
            style={{
              backgroundColor: theme.surface.base,
              bottom: 0,
              left: 0,
              position: "absolute",
              top: 0,
              width: 48,
              zIndex: 1,
            }}
          >
            <FlatList
              data={data}
              extraData={listExtraData}
              getItemLayout={getRowItemLayout}
              initialNumToRender={DATA_TABLE_INITIAL_NUM_TO_RENDER}
              keyExtractor={keyExtractor}
              maxToRenderPerBatch={DATA_TABLE_MAX_TO_RENDER_PER_BATCH}
              onScroll={handleMoreVerticalScroll}
              ref={moreListRef}
              renderItem={renderMoreRow}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              windowSize={DATA_TABLE_WINDOW_SIZE}
            />
          </View>
        )}

        {pinnedColumns > 0 && (
          <View
            style={{
              bottom: 0,
              left: moreColumnOffset,
              position: "absolute",
              top: 0,
              width: pinnedWidth,
              zIndex: 10,
            }}
          >
            <FlatList
              data={data}
              extraData={listExtraData}
              getItemLayout={getRowItemLayout}
              initialNumToRender={DATA_TABLE_INITIAL_NUM_TO_RENDER}
              keyExtractor={keyExtractor}
              maxToRenderPerBatch={DATA_TABLE_MAX_TO_RENDER_PER_BATCH}
              onScroll={handlePinnedVerticalScroll}
              ref={pinnedListRef}
              renderItem={renderPinnedRow}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              windowSize={DATA_TABLE_WINDOW_SIZE}
            />
          </View>
        )}

        <ScrollView
          horizontal
          nestedScrollEnabled
          onScroll={(event) => onScroll(event, false)}
          ref={bodyScrollRef}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator
          style={{
            flex: 1,
            marginLeft: pinnedWidth + moreColumnOffset,
          }}
        >
          <View style={{width: scrollableWidth}}>
            <FlatList
              data={data}
              extraData={listExtraData}
              getItemLayout={getRowItemLayout}
              initialNumToRender={DATA_TABLE_INITIAL_NUM_TO_RENDER}
              keyExtractor={keyExtractor}
              maxToRenderPerBatch={DATA_TABLE_MAX_TO_RENDER_PER_BATCH}
              nestedScrollEnabled
              onScroll={handleBodyVerticalScroll}
              ref={bodyListRef}
              renderItem={renderScrollableRow}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator
              windowSize={DATA_TABLE_WINDOW_SIZE}
            />
          </View>
        </ScrollView>
      </View>

      {MoreContentContent && (
        <Modal
          onDismiss={() => setModalRow(null)}
          size={moreContentSize}
          visible={modalRow !== null}
        >
          <MoreContentContent
            column={columns[0]}
            rowData={data[modalRow!]}
            rowIndex={modalRow!}
            {...(moreContentExtraData?.[modalRow!] ?? {})}
          />
        </Modal>
      )}
    </>
  );
};

const DataTableContent = memo(DataTableContentComponent);

const DataTableComponent: FC<DataTableProps> = ({
  data,
  columns,
  alternateRowBackground = true,
  totalPages = 1,
  page = 0,
  setPage,
  pinnedColumns = 0,
  sortColumn,
  setSortColumn,
  moreContentComponent,
  moreContentExtraData,
  customColumnComponentMap,
  rowHeight = 54,
  headerHeight,
  defaultTextSize = "md",
  testID,
  testIDs,
  getRowTestID,
  emptyContent,
  additionalFilters = [],
  search = "",
  searchFields,
  onSearchChange,
  filterValues,
  onFilterValuesChange,
  onQueryChange,
}) => {
  const {theme} = useTheme();
  const tableTestIDs = resolveDataTableTestIDsFromProps({testID, testIDs});
  const headerScrollRef = useRef<ScrollView>(null);
  const bodyScrollRef = useRef<ScrollView>(null);
  const lastEmittedQueryRef = useRef<string | undefined>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [isNativeFiltersOpen, setIsNativeFiltersOpen] = useState(false);
  const [nativeDraftValues, setNativeDraftValues] = useState<Record<string, unknown>>({});
  const [nativeSearchDraft, setNativeSearchDraft] = useState(search);

  const columnFilters = useMemo(() => {
    const visibleColumnFilters = columns
      .map((column) => column.filter)
      .filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
    return [...visibleColumnFilters, ...additionalFilters];
  }, [additionalFilters, columns]);
  const showSearch = Boolean(searchFields && searchFields.length > 0 && onSearchChange);
  const showAdditionalFilters =
    Platform.OS === "web" && additionalFilters.length > 0 && Boolean(onFilterValuesChange);
  const showNativeFilters =
    Platform.OS !== "web" &&
    (columnFilters.length > 0 || showSearch) &&
    Boolean(onFilterValuesChange || onSearchChange);

  // Debounce toolbar search before emitting server query params.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, DATA_TABLE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  // Emit modelRouter-shaped query params when debounced search or filters change.
  useEffect(() => {
    if (!onQueryChange) {
      return;
    }
    const query = buildDataTableListQuery({
      columns,
      filters: additionalFilters,
      filterValues,
      search: debouncedSearch,
      searchFields,
    });
    const signature = JSON.stringify(query);
    if (signature === lastEmittedQueryRef.current) {
      return;
    }
    lastEmittedQueryRef.current = signature;
    onQueryChange(query);
  }, [additionalFilters, columns, debouncedSearch, filterValues, onQueryChange, searchFields]);

  const handleOpenNativeFilters = useCallback((): void => {
    setNativeDraftValues(filterValues ?? {});
    setNativeSearchDraft(search);
    setIsNativeFiltersOpen(true);
  }, [filterValues, search]);

  const handleApplyNativeFilters = useCallback((): void => {
    onFilterValuesChange?.(nativeDraftValues);
    onSearchChange?.(nativeSearchDraft);
    setIsNativeFiltersOpen(false);
  }, [nativeDraftValues, nativeSearchDraft, onFilterValuesChange, onSearchChange]);

  const handleClearNativeFilters = useCallback((): void => {
    const cleared: Record<string, unknown> = {};
    for (const filter of columnFilters) {
      if (filter.kind === "dateRange") {
        cleared[`${filter.field}_gte`] = undefined;
        cleared[`${filter.field}_lte`] = undefined;
      } else {
        cleared[filter.field] = undefined;
      }
    }
    setNativeDraftValues(cleared);
    setNativeSearchDraft("");
  }, [columnFilters]);

  const columnWidths = useMemo(() => columns.map((col) => col.width), [columns]);
  const pinnedLeftOffsets = useMemo(() => {
    let currentOffset = 0;
    return columnWidths.map((width) => {
      const offset = currentOffset;
      currentOffset += width;
      return offset;
    });
  }, [columnWidths]);
  const pinnedWidth = useMemo(
    () => columnWidths.slice(0, pinnedColumns).reduce((sum, width) => sum + width, 0),
    [columnWidths, pinnedColumns]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>, isHeader: boolean) => {
      const scrollX = event.nativeEvent.contentOffset.x;
      if (isHeader && bodyScrollRef.current) {
        bodyScrollRef.current.scrollTo({animated: false, x: scrollX});
      } else if (!isHeader && headerScrollRef.current) {
        headerScrollRef.current.scrollTo({animated: false, x: scrollX});
      }
    },
    []
  );

  const handleSort = useCallback(
    (columnIndex: number) => {
      if (!setSortColumn || !columns[columnIndex].sortable) {
        return;
      }

      if (sortColumn?.column === columnIndex) {
        if (sortColumn.direction === "asc") {
          setSortColumn({
            column: columnIndex,
            direction: "desc",
          });
        } else {
          setSortColumn(undefined);
        }
      } else {
        setSortColumn({
          column: columnIndex,
          direction: "asc",
        });
      }
    },
    [sortColumn, setSortColumn, columns]
  );

  return (
    <View
      style={{display: "flex", flexDirection: "column", height: "100%"}}
      testID={tableTestIDs.root}
    >
      {showSearch || showNativeFilters || showAdditionalFilters ? (
        <Box
          alignItems="center"
          direction="row"
          gap={2}
          marginBottom={2}
          paddingX={2}
          paddingY={2}
          wrap
        >
          {showSearch ? (
            <Box flex="grow" minWidth={200}>
              <TextField
                onChange={onSearchChange!}
                testID="data-table-search"
                title="Search"
                type="search"
                value={search}
              />
            </Box>
          ) : null}
          {showNativeFilters ? (
            <Button
              iconName="filter"
              onClick={handleOpenNativeFilters}
              testID="data-table-filters-trigger"
              text="Filters"
              variant="outline"
            />
          ) : null}
          {showAdditionalFilters && onFilterValuesChange ? (
            <DataTableAdditionalFiltersWeb
              appliedValues={filterValues ?? {}}
              filters={additionalFilters}
              onApply={onFilterValuesChange}
            />
          ) : null}
        </Box>
      ) : null}
      <View
        style={{
          borderColor: theme.border.default,
          borderWidth: 1,
          flex: 1,
          height: "100%",
          minHeight: 0,
        }}
        testID={tableTestIDs.body}
      >
        <DataTableHeader
          columns={columns}
          filterValues={filterValues}
          hasMoreContent={Boolean(moreContentComponent)}
          headerHeight={headerHeight}
          headerScrollRef={headerScrollRef}
          onFilterValuesChange={onFilterValuesChange}
          onScroll={handleScroll}
          onSort={handleSort}
          pinnedColumns={pinnedColumns}
          pinnedLeftOffsets={pinnedLeftOffsets}
          pinnedWidth={pinnedWidth}
          rowHeight={rowHeight}
          sortColumn={sortColumn}
          testID={tableTestIDs.header}
        />

        <View style={{flex: 1, minHeight: 0}}>
          {data.length === 0 && emptyContent ? (
            emptyContent
          ) : (
            <DataTableContent
              alternateRowBackground={alternateRowBackground}
              bodyScrollRef={bodyScrollRef}
              columns={columns}
              customColumnComponentMap={customColumnComponentMap}
              data={data}
              defaultTextSize={defaultTextSize}
              getRowTestID={getRowTestID}
              moreContentComponent={moreContentComponent}
              moreContentExtraData={moreContentExtraData}
              onScroll={handleScroll}
              pinnedColumns={pinnedColumns}
              pinnedLeftOffsets={pinnedLeftOffsets}
              pinnedWidth={pinnedWidth}
              rowHeight={rowHeight}
              rowTestIdBase={tableTestIDs.row}
            />
          )}
        </View>
      </View>

      {Boolean(setPage && totalPages > 1) && (
        <View
          style={{
            alignItems: "center",
            height: 60,
            padding: 16,
          }}
        >
          <Pagination
            page={page}
            setPage={setPage!}
            testID={tableTestIDs.pagination}
            totalPages={totalPages}
          />
        </View>
      )}
      {showNativeFilters ? (
        <Modal
          onDismiss={() => setIsNativeFiltersOpen(false)}
          primaryButtonOnClick={handleApplyNativeFilters}
          primaryButtonText="Apply"
          secondaryButtonOnClick={() => setIsNativeFiltersOpen(false)}
          secondaryButtonText="Cancel"
          testID="data-table-filters-sheet"
          title="Filters"
          visible={isNativeFiltersOpen}
        >
          <Box direction="column" gap={3}>
            <DataTableFilterFields
              draftValues={nativeDraftValues}
              filters={columnFilters}
              onDraftChange={setNativeDraftValues}
              onSearchDraftChange={setNativeSearchDraft}
              search={nativeSearchDraft}
              showFieldClear
              showSearch={showSearch}
            />
            <Button onClick={handleClearNativeFilters} text="Clear all" variant="ghost" />
          </Box>
        </Modal>
      ) : null}
    </View>
  );
};

DataTableComponent.displayName = "DataTable";

export const DataTable = memo(DataTableComponent);
