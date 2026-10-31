import {
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  Text,
} from "@terreno/ui";
import type React from "react";
import {type FC, useCallback, useState} from "react";

const CustomColumnComponent: FC<{column: DataTableColumn; cellData: DataTableCellData}> = ({
  cellData,
}) => {
  const customValue = cellData.value as {text?: string} | undefined;
  return <Text>Custom: {customValue?.text ?? ""}</Text>;
};

const MoreModalContent: FC<{
  column: DataTableColumn;
  rowData: DataTableCellData[];
  rowIndex: number;
}> = ({rowIndex}) => {
  return (
    <Box paddingY={8}>
      <Text>Drawer contents for row {rowIndex}</Text>
      <Button onClick={() => console.info("Button clicked")} text="Console.log()" />
    </Box>
  );
};

export const StandardDataTable = (): React.ReactElement => {
  const [allRows] = useState([
    [
      {value: "Data 1 has some data in it"},
      {value: "Data 2 has some longer data in it"},
      {highlight: "successLight" as const, value: 5},
      {highlight: "errorLight" as const, value: 1000.4},
      {highlight: "warningLight" as const, value: "2024-01-01"},
      {highlight: "successLight" as const, value: true},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 2 short"},
      {value: "Row 2 long"},
      {value: 10},
      {value: 2000.0},
      {value: "2024-01-02"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
    [
      {
        highlight: "warningLight" as const,
        value:
          "Row 3 very long, lots of overflow here, wow is this still going? I hope it all fits!",
      },
      {value: "Row 3 long"},
      {value: 1},
      {value: 2},
      {value: "2024-01-03"},
      {value: true},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 4"},
      {value: "Row 4"},
      {value: 1},
      {value: 2},
      {value: "2024-01-04"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
    [
      {highlight: "error" as const, value: "Row 5"},
      {value: "Row 5"},
      {value: 1},
      {value: 2},
      {value: "2024-01-05"},
      {value: true},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 6"},
      {value: "Row 6"},
      {value: 1},
      {value: 2},
      {value: "2024-01-06"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 7"},
      {value: "Row 7"},
      {value: 1},
      {value: 2},
      {value: "2024-01-07"},
      {value: true},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 8"},
      {value: "Row 8"},
      {value: 1},
      {value: 2},
      {value: "2024-01-08"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 9"},
      {value: "Row 9"},
      {value: 1},
      {value: 2},
      {value: "2024-01-09"},
      {value: true},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 10"},
      {value: "Row 10"},
      {value: 1},
      {value: 2},
      {value: "2024-01-10"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 11"},
      {value: "Row 11"},
      {value: 1},
      {value: 2},
      {value: "2024-01-11"},
      {value: true},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 12"},
      {value: "Row 12"},
      {value: 1},
      {value: 2},
      {value: "2024-01-12"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 13"},
      {value: "Row 13"},
      {value: 1},
      {value: 2},
      {value: "2024-01-13"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 14"},
      {value: "Row 14"},
      {value: 1},
      {value: 2},
      {value: "2024-01-14"},
      {value: true},
      {value: {text: "Custom text"}},
    ],
    [
      {value: "Row 15"},
      {value: "Row 15"},
      {value: 1},
      {value: 2},
      {value: "2024-01-15"},
      {value: false},
      {value: {text: "Custom text"}},
    ],
  ]);

  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  const rows = allRows.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const [sortColumn, setSortColumn] = useState<
    {column: number; direction: "asc" | "desc"} | undefined
  >();

  const columns: DataTableColumn[] = [
    {
      columnType: "text",
      infoModalText: `# This is a tooltip\n\nHello, this is some *italic text* and **bold text**.`,
      sortable: true,
      title: "Column 1",
      width: 200,
    },
    {columnType: "text", sortable: false, title: "Column 2", width: 200},
    {columnType: "number", sortable: true, title: "Column 3", width: 200},
    {columnType: "number", sortable: false, title: "Column 4", width: 200},
    {columnType: "date", sortable: true, title: "Column 5", width: 200},
    {columnType: "boolean", sortable: false, title: "Checked", width: 200},
    {columnType: "custom", sortable: false, title: "Custom", width: 200},
  ];

  if (sortColumn) {
    rows.sort((a, b) => {
      return sortColumn.direction === "asc"
        ? a[sortColumn.column].value > b[sortColumn.column].value
          ? 1
          : -1
        : a[sortColumn.column].value < b[sortColumn.column].value
          ? 1
          : -1;
    });
  }

  return (
    <Box color="base" direction="column" height="100%" maxHeight={400} maxWidth={600} scroll>
      <DataTable
        alternateRowBackground
        columns={columns}
        customColumnComponentMap={{custom: CustomColumnComponent}}
        data={rows}
        defaultTextSize="sm"
        headerHeight={40}
        moreContentComponent={MoreModalContent}
        page={page}
        pinnedColumns={1}
        rowHeight={80}
        setPage={setPage}
        setSortColumn={setSortColumn}
        sortColumn={sortColumn}
        totalPages={Math.ceil(allRows.length / rowsPerPage)}
      />
    </Box>
  );
};

const LARGE_VIRTUAL_ROW_COUNT = 1200;

const buildLargeVirtualColumns = (): DataTableColumn[] => [
  {
    columnType: "text",
    sortable: true,
    title: "Name",
    width: 180,
  },
  {columnType: "text", title: "Department", width: 160},
  {columnType: "number", sortable: true, title: "Score", width: 120},
  {columnType: "boolean", title: "Active", width: 100},
  {columnType: "custom", title: "Custom", width: 160},
];

const buildLargeVirtualRows = (rowCount: number): DataTableCellData[][] =>
  Array.from({length: rowCount}, (_, rowIndex) => [
    {
      highlight: rowIndex % 7 === 0 ? ("warningLight" as const) : undefined,
      value: `Employee ${rowIndex + 1}`,
    },
    {value: `Team ${(rowIndex % 12) + 1}`},
    {value: rowIndex * 3},
    {value: rowIndex % 2 === 0},
    {value: {text: `Badge ${rowIndex + 1}`}},
  ]);

export const FilterableDataTable = (): React.ReactElement => {
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [queryLog, setQueryLog] = useState<string>("{}");
  const handleQueryChange = useCallback((params: Record<string, unknown>): void => {
    setQueryLog(JSON.stringify(params));
  }, []);
  const columns: DataTableColumn[] = [
    {
      columnType: "text",
      filter: {field: "name", kind: "text"},
      sortable: true,
      title: "Name",
      width: 180,
    },
    {
      columnType: "boolean",
      filter: {field: "active", kind: "boolean"},
      title: "Active",
      width: 120,
    },
    {
      columnType: "date",
      filter: {field: "created", kind: "dateRange"},
      title: "Created",
      width: 180,
    },
    {
      columnType: "text",
      filter: {
        field: "role",
        kind: "choice",
        options: [
          {label: "Staff", value: "staff"},
          {label: "Admin", value: "admin"},
        ],
      },
      title: "Role",
      width: 160,
    },
  ];
  const data: DataTableCellData[][] = [
    [{value: "Alice"}, {value: true}, {value: "2024-01-01"}, {value: "admin"}],
    [{value: "Bob"}, {value: false}, {value: "2024-02-01"}, {value: "staff"}],
  ];

  return (
    <Box direction="column" gap={3} height={500} maxWidth={900} padding={3}>
      <Text>Latest query: {queryLog}</Text>
      <DataTable
        additionalFilters={[
          {
            field: "department",
            kind: "choice",
            label: "Department",
            options: [
              {label: "Engineering", value: "engineering"},
              {label: "Operations", value: "operations"},
            ],
          },
        ]}
        columns={columns}
        data={data}
        filterValues={filterValues}
        onFilterValuesChange={setFilterValues}
        onQueryChange={handleQueryChange}
        onSearchChange={setSearch}
        search={search}
        searchFields={["name", "role"]}
      />
    </Box>
  );
};

const AUTO_WIDTH_COLUMNS: DataTableColumn[] = [
  {columnType: "text", sortable: true, title: "Name"},
  {columnType: "text", title: "Email"},
  {columnType: "text", title: "Role"},
  {columnType: "number", sortable: true, title: "Visits"},
  {columnType: "date", title: "Last seen"},
  {columnType: "boolean", title: "Active"},
  // An explicit width still wins over auto sizing.
  {columnType: "text", title: "Fixed 140", width: 140},
];

const AUTO_WIDTH_ROWS: DataTableCellData[][] = [
  [
    {value: "Alice Johnson"},
    {value: "alice.johnson@example.com"},
    {value: "Admin"},
    {value: 128},
    {value: "2026-10-01"},
    {value: true},
    {value: "pinned"},
  ],
  [
    {value: "Bob Li"},
    {value: "bob@example.com"},
    {value: "Staff"},
    {value: 7},
    {value: "2026-09-14"},
    {value: false},
    {value: "pinned"},
  ],
  [
    {value: "Carmen Ruiz-Delgado"},
    {value: "carmen.ruiz-delgado@example.com"},
    {value: "Care coordinator"},
    {value: 3021},
    {value: "2026-10-20"},
    {value: true},
    {value: "pinned"},
  ],
];

export const AutoWidthDataTable = (): React.ReactElement => {
  const [isNarrow, setIsNarrow] = useState(false);
  return (
    <Box direction="column" gap={3} padding={3}>
      <Box direction="row" gap={2}>
        <Button
          onClick={() => setIsNarrow((previous) => !previous)}
          testID="auto-width-toggle"
          text={isNarrow ? "Make container wide" : "Make container narrow"}
          variant="outline"
        />
      </Box>
      <Box height={260} testID="auto-width-container" width={isNarrow ? 480 : "100%"}>
        <DataTable columns={AUTO_WIDTH_COLUMNS} data={AUTO_WIDTH_ROWS} testID="auto-width-table" />
      </Box>
    </Box>
  );
};

export const LargeVirtualizedDataTable = (): React.ReactElement => {
  const [pinnedColumns, setPinnedColumns] = useState(1);
  const [sortColumn, setSortColumn] = useState<
    {column: number; direction: "asc" | "desc"} | undefined
  >();
  const [rows] = useState(() => buildLargeVirtualRows(LARGE_VIRTUAL_ROW_COUNT));
  const columns = buildLargeVirtualColumns();

  const sortedRows = [...rows];
  if (sortColumn) {
    sortedRows.sort((leftRow, rightRow) => {
      const leftValue = leftRow[sortColumn.column].value;
      const rightValue = rightRow[sortColumn.column].value;
      if (leftValue === rightValue) {
        return 0;
      }
      const cmp =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return sortColumn.direction === "asc" ? cmp : -cmp;
    });
  }

  return (
    <Box color="base" direction="column" gap={3} height="100%" maxHeight={480} maxWidth={900}>
      <Box direction="row" gap={2}>
        <Button
          onClick={() => setPinnedColumns((current) => (current > 0 ? 0 : 1))}
          text={pinnedColumns > 0 ? "Unpin columns" : "Pin first column"}
          variant="secondary"
        />
        <Text>
          {LARGE_VIRTUAL_ROW_COUNT} rows — scroll vertically to load distant rows and sort pinned
          headers.
        </Text>
      </Box>
      <Box flex="grow" minHeight={0}>
        <DataTable
          alternateRowBackground
          columns={columns}
          customColumnComponentMap={{custom: CustomColumnComponent}}
          data={sortedRows}
          defaultTextSize="sm"
          getRowTestID={(_, rowIndex) => rowIndex}
          headerHeight={40}
          moreContentComponent={MoreModalContent}
          pinnedColumns={pinnedColumns}
          rowHeight={48}
          setSortColumn={setSortColumn}
          sortColumn={sortColumn}
          testID="large-virtual-table"
          testIDs={{row: "large-virtual-table.row"}}
        />
      </Box>
    </Box>
  );
};
