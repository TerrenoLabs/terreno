import {describe, it} from "bun:test";
import {act, fireEvent, render} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import {useState} from "react";
import {FlatList, Pressable, View} from "react-native";

import type {DataTableCellData, DataTableColumn} from "./Common";
import {DataTable} from "./DataTable";
import {ThemeProvider} from "./Theme";

const LARGE_ROW_COUNT = 1000;
const ROW_TEST_ID_BASE = "virtual-table.row";
const ROW_HEIGHT = 54;
const VIEWPORT_BOUNDED_ROW_THRESHOLD = 80;

const columns: DataTableColumn[] = [
  {columnType: "text", sortable: true, title: "Name", width: 150},
  {columnType: "text", title: "Age", width: 100},
  {columnType: "boolean", title: "Active", width: 100},
];

const buildLargeData = (size: number): DataTableCellData[][] =>
  Array.from({length: size}, (_, rowIndex) => [
    {value: `Row ${rowIndex + 1}`},
    {value: String(rowIndex + 20)},
    {value: rowIndex % 2 === 0},
  ]);

const countRowTestIDs = (getByTestId: (id: string) => unknown, size: number): number => {
  let count = 0;
  for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
    try {
      getByTestId(`${ROW_TEST_ID_BASE}-${rowIndex}`);
      count += 1;
    } catch {
      // Row is not mounted in the virtualized viewport.
    }
  }
  return count;
};

describe("DataTable virtualization regression coverage", () => {
  it("keeps mounted rows viewport-bounded for unpinned large tables", () => {
    const data = buildLargeData(LARGE_ROW_COUNT);
    const result = render(
      <ThemeProvider>
        <DataTable
          columns={columns}
          data={data}
          getRowTestID={(_, rowIndex) => rowIndex}
          rowHeight={ROW_HEIGHT}
          testID="virtual-table"
          testIDs={{row: ROW_TEST_ID_BASE}}
        />
      </ThemeProvider>
    );

    const mountedRowCount = countRowTestIDs(result.getByTestId, LARGE_ROW_COUNT);
    assert.isBelow(mountedRowCount, VIEWPORT_BOUNDED_ROW_THRESHOLD);
    assert.isBelow(mountedRowCount, LARGE_ROW_COUNT);
    assert.exists(result.getByTestId(`${ROW_TEST_ID_BASE}-0`));
    assert.throws(() => result.getByTestId(`${ROW_TEST_ID_BASE}-${LARGE_ROW_COUNT - 1}`));
  });

  it("keeps mounted rows viewport-bounded for pinned large tables", () => {
    const data = buildLargeData(LARGE_ROW_COUNT);
    const result = render(
      <ThemeProvider>
        <DataTable
          columns={columns}
          data={data}
          getRowTestID={(_, rowIndex) => rowIndex}
          pinnedColumns={1}
          rowHeight={ROW_HEIGHT}
          testID="virtual-table"
          testIDs={{row: ROW_TEST_ID_BASE}}
        />
      </ThemeProvider>
    );

    const mountedRowCount = countRowTestIDs(result.getByTestId, LARGE_ROW_COUNT);
    assert.isBelow(mountedRowCount, VIEWPORT_BOUNDED_ROW_THRESHOLD);
    assert.exists(result.getByTestId(`${ROW_TEST_ID_BASE}-0`));
    assert.throws(() => result.getByTestId(`${ROW_TEST_ID_BASE}-${LARGE_ROW_COUNT - 1}`));
  });

  it("does not feedback-loop when syncing vertical scroll between body and pinned lists", () => {
    const data = buildLargeData(LARGE_ROW_COUNT);
    const result = render(
      <ThemeProvider>
        <DataTable columns={columns} data={data} pinnedColumns={1} rowHeight={ROW_HEIGHT} />
      </ThemeProvider>
    );

    const flatLists = result.UNSAFE_getAllByType(FlatList);
    const bodyList = flatLists.find((list) => list.props.showsVerticalScrollIndicator === true);
    const pinnedList = flatLists.find((list) => list.props.showsVerticalScrollIndicator === false);
    assert.exists(bodyList);
    assert.exists(pinnedList);

    const bodyRef = (
      bodyList as {
        props: {ref?: React.RefObject<{scrollToOffset?: (opts: {offset: number}) => void}>};
      }
    ).props.ref?.current;
    const pinnedRef = (
      pinnedList as {
        props: {ref?: React.RefObject<{scrollToOffset?: (opts: {offset: number}) => void}>};
      }
    ).props.ref?.current;
    assert.exists(bodyRef?.scrollToOffset);
    assert.exists(pinnedRef?.scrollToOffset);

    const bodyScrollToOffsetCalls: number[] = [];
    const pinnedScrollToOffsetCalls: number[] = [];
    const originalBodyScrollToOffset = bodyRef!.scrollToOffset!.bind(bodyRef);
    const originalPinnedScrollToOffset = pinnedRef!.scrollToOffset!.bind(pinnedRef);

    bodyRef!.scrollToOffset = (opts: {offset: number}) => {
      bodyScrollToOffsetCalls.push(opts.offset);
      originalBodyScrollToOffset(opts);
    };
    pinnedRef!.scrollToOffset = (opts: {offset: number}) => {
      pinnedScrollToOffsetCalls.push(opts.offset);
      originalPinnedScrollToOffset(opts);
    };

    const scrollY = ROW_HEIGHT * 10;
    act((): void => {
      bodyList!.props.onScroll?.({nativeEvent: {contentOffset: {x: 0, y: scrollY}}});
    });

    assert.deepEqual(pinnedScrollToOffsetCalls, [scrollY]);
    assert.deepEqual(bodyScrollToOffsetCalls, []);
  });

  it("keeps pinned rows aligned with later leader scroll events during the sync lock", async () => {
    const data = buildLargeData(LARGE_ROW_COUNT);
    const result = render(
      <ThemeProvider>
        <DataTable
          columns={columns}
          data={data}
          getRowTestID={(_, rowIndex) => rowIndex}
          pinnedColumns={1}
          rowHeight={ROW_HEIGHT}
          testIDs={{row: ROW_TEST_ID_BASE}}
        />
      </ThemeProvider>
    );

    const bodyList = result
      .UNSAFE_getAllByType(FlatList)
      .find((list) => list.props.showsVerticalScrollIndicator === true);
    assert.exists(bodyList);

    const firstScrollY = ROW_HEIGHT * 10;
    const secondScrollY = ROW_HEIGHT * 200;
    act((): void => {
      bodyList!.props.onScroll?.({nativeEvent: {contentOffset: {x: 0, y: firstScrollY}}});
      bodyList!.props.onScroll?.({nativeEvent: {contentOffset: {x: 0, y: secondScrollY}}});
    });
    assert.exists(result.getByText("Row 201"));
    assert.throws(() => result.getByText("Row 11"));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    assert.exists(result.getByText("Row 201"));
    assert.throws(() => result.getByText("Row 11"));
  });

  it("aligns pinned list to body scroll offset when pinned columns mount", () => {
    const data = buildLargeData(LARGE_ROW_COUNT);
    const distantRowIndex = 500;

    const TableProbe: React.FC = () => {
      const [pinnedColumns, setPinnedColumns] = useState(0);

      return (
        <ThemeProvider>
          <DataTable
            columns={columns}
            data={data}
            getRowTestID={(_, rowIndex) => rowIndex}
            pinnedColumns={pinnedColumns}
            rowHeight={ROW_HEIGHT}
            testIDs={{row: ROW_TEST_ID_BASE}}
          />
          <Pressable onPress={() => setPinnedColumns(1)} testID="enable-pinned">
            <View />
          </Pressable>
        </ThemeProvider>
      );
    };

    const result = render(<TableProbe />);
    const bodyList = result
      .UNSAFE_getAllByType(FlatList)
      .find((list) => list.props.showsVerticalScrollIndicator === true);
    assert.exists(bodyList);

    act((): void => {
      bodyList!.props.ref?.current?.scrollToIndex?.({animated: false, index: distantRowIndex});
    });
    assert.throws(() => result.getByText("Row 1"));
    assert.exists(result.getByText(`Row ${distantRowIndex + 1}`));

    act((): void => {
      fireEvent.press(result.getByTestId("enable-pinned"));
    });

    assert.throws(() => result.getByText("Row 1"));
    assert.exists(result.getByText(`Row ${distantRowIndex + 1}`));
  });

  it("renders changed row values after scrolling to a distant index", () => {
    const baseline = buildLargeData(LARGE_ROW_COUNT);
    const changed = baseline.map((row, rowIndex) =>
      rowIndex === 500 ? [{value: "Updated 500"}, ...row.slice(1)] : row
    );

    const ScrollProbe: React.FC = () => {
      const [data, setData] = useState(baseline);

      return (
        <ThemeProvider>
          <DataTable
            columns={columns}
            data={data}
            getRowTestID={(_, rowIndex) => rowIndex}
            rowHeight={ROW_HEIGHT}
            testID="virtual-table"
            testIDs={{row: ROW_TEST_ID_BASE}}
          />
          <Pressable onPress={() => setData(changed)} testID="apply-change">
            <View />
          </Pressable>
        </ThemeProvider>
      );
    };

    const result = render(<ScrollProbe />);
    const flatLists = result.UNSAFE_getAllByType(FlatList);
    const bodyList = flatLists.find((list) => list.props.getItemLayout !== undefined);
    assert.exists(bodyList);

    const listRef = (bodyList as {props: {ref?: React.RefObject<FlatList>}}).props.ref?.current as
      | {
          scrollToIndex?: (options: {animated?: boolean; index: number}) => void;
        }
      | undefined;
    assert.exists(listRef?.scrollToIndex);

    act((): void => {
      listRef?.scrollToIndex?.({animated: false, index: 500});
    });
    act((): void => {
      fireEvent.press(result.getByTestId("apply-change"));
    });

    assert.exists(result.getByTestId(`${ROW_TEST_ID_BASE}-500`));
    assert.exists(result.getByText("Updated 500"));
    assert.throws(() => result.getByText("Row 501"));
  });
});
