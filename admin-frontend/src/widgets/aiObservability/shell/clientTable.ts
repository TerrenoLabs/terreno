import type {
  ColumnSortInterface,
  DataTableCellData,
  DataTableColumn,
  DataTableColumnFilter,
} from "@terreno/ui";
import {DateTime} from "luxon";
import {useCallback, useMemo, useState} from "react";

export type ClientTableValue = boolean | number | string | undefined;

/** One DataTable column over fully loaded rows; `value` drives sorting and filtering. */
export interface ClientTableColumn<Row> {
  /** Display cell for the row; defaults to `{value: value(row)}`. */
  cell?: (row: Row) => DataTableCellData;
  columnType?: DataTableColumn["columnType"];
  /** Column filter shown in the DataTable header. `field` defaults to the column key. */
  filter?: Omit<DataTableColumnFilter, "field"> & {field?: string};
  key: string;
  /** Sortable unless false; columns without `value` never sort. */
  sortable?: boolean;
  title: string;
  /** Raw comparable value: numbers sort numerically, ISO dates by time, everything else as text. */
  value?: (row: Row) => ClientTableValue;
  width: number;
}

export interface ClientTableState<Row> {
  columns: DataTableColumn[];
  data: DataTableCellData[][];
  filterValues: Record<string, unknown>;
  onFilterValuesChange: (next: Record<string, unknown>) => void;
  onSearchChange?: (search: string) => void;
  rows: Row[];
  search: string;
  searchFields?: string[];
  setSortColumn: (sort?: ColumnSortInterface) => void;
  sortColumn?: ColumnSortInterface;
}

const isBlank = (value: unknown): boolean => {
  return value === undefined || value === null || value === "";
};

const toTime = (value: ClientTableValue): number | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = DateTime.fromISO(value);
  return parsed.isValid ? parsed.toMillis() : undefined;
};

/** Compare two cell values; blanks always sort last. */
export const compareClientValues = (a: ClientTableValue, b: ClientTableValue): number => {
  if (isBlank(a) || isBlank(b)) {
    return Number(isBlank(a)) - Number(isBlank(b));
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  const aTime = toTime(a);
  const bTime = toTime(b);
  if (aTime !== undefined && bTime !== undefined) {
    return aTime - bTime;
  }
  return String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: "base"});
};

const numberRange = (value: unknown): {max?: number; min?: number} | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as {$gte?: unknown; $lte?: unknown; gte?: unknown; lte?: unknown};
  const min = record.$gte ?? record.gte;
  const max = record.$lte ?? record.lte;
  return {
    max: typeof max === "number" ? max : undefined,
    min: typeof min === "number" ? min : undefined,
  };
};

const choiceValues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(String).filter((entry) => entry !== "");
  }
  return typeof value === "string" && value !== "" ? [value] : [];
};

/** Whether one row value passes one column filter's current value. */
export const matchesClientFilter = (
  filter: DataTableColumnFilter,
  value: ClientTableValue,
  filterValues: Record<string, unknown>
): boolean => {
  const current = filterValues[filter.field];
  if (filter.kind === "text") {
    const text = typeof current === "string" ? current.trim().toLowerCase() : "";
    return (
      !text ||
      String(value ?? "")
        .toLowerCase()
        .includes(text)
    );
  }
  if (filter.kind === "boolean") {
    return typeof current !== "boolean" || Boolean(value) === current;
  }
  if (filter.kind === "choice") {
    const choices = choiceValues(current);
    return choices.length === 0 || choices.includes(String(value ?? ""));
  }
  if (filter.kind === "numberRange") {
    const range = numberRange(current);
    if (!range || (range.min === undefined && range.max === undefined)) {
      return true;
    }
    if (typeof value !== "number") {
      return false;
    }
    return (
      (range.min === undefined || value >= range.min) &&
      (range.max === undefined || value <= range.max)
    );
  }
  const from = toTime(filterValues[`${filter.field}_gte`] as ClientTableValue);
  const to = toTime(filterValues[`${filter.field}_lte`] as ClientTableValue);
  if (from === undefined && to === undefined) {
    return true;
  }
  const time = toTime(value);
  if (time === undefined) {
    return false;
  }
  return (from === undefined || time >= from) && (to === undefined || time <= to);
};

/** Choice filter options from the distinct values in a column. */
export const distinctChoiceOptions = <Row>(
  rows: Row[],
  value: (row: Row) => ClientTableValue
): Array<{label: string; value: string}> => {
  const seen = new Set<string>();
  for (const row of rows) {
    const entry = value(row);
    if (!isBlank(entry)) {
      seen.add(String(entry));
    }
  }
  return [...seen]
    .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))
    .map((entry) => ({label: entry, value: entry}));
};

/**
 * Sorting, column filters, and search for DataTables whose rows are already loaded. Spread the
 * returned state (minus `rows`) onto `DataTable`.
 */
export const useClientTable = <Row>({
  columns,
  defaultSort,
  rows,
  searchText,
}: {
  columns: ClientTableColumn<Row>[];
  defaultSort?: ColumnSortInterface;
  rows: Row[];
  /** Text a row matches for the toolbar search; omit to hide search. */
  searchText?: (row: Row) => string;
}): ClientTableState<Row> => {
  const [sortColumn, setSortColumn] = useState<ColumnSortInterface | undefined>(defaultSort);
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState("");

  const filters = useMemo(
    () =>
      columns.map((column): DataTableColumnFilter | undefined =>
        column.filter ? {...column.filter, field: column.filter.field ?? column.key} : undefined
      ),
    [columns]
  );

  const tableColumns = useMemo(
    (): DataTableColumn[] =>
      columns.map((column, index) => ({
        columnType: column.columnType ?? "text",
        filter: filters[index],
        sortable: column.sortable !== false && Boolean(column.value),
        title: column.title,
        width: column.width,
      })),
    [columns, filters]
  );

  const visibleRows = useMemo((): Row[] => {
    const query = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (query && searchText && !searchText(row).toLowerCase().includes(query)) {
        return false;
      }
      return columns.every((column, index) => {
        const filter = filters[index];
        if (!filter || !column.value) {
          return true;
        }
        return matchesClientFilter(filter, column.value(row), filterValues);
      });
    });
    const sortBy = sortColumn ? columns[sortColumn.column]?.value : undefined;
    if (!sortColumn || !sortBy) {
      return filtered;
    }
    const direction = sortColumn.direction === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const aValue = sortBy(a);
      const bValue = sortBy(b);
      // Blanks stay last in both directions.
      if (isBlank(aValue) || isBlank(bValue)) {
        return compareClientValues(aValue, bValue);
      }
      return direction * compareClientValues(aValue, bValue);
    });
  }, [columns, filterValues, filters, rows, search, searchText, sortColumn]);

  const data = useMemo(
    (): DataTableCellData[][] =>
      visibleRows.map((row) =>
        columns.map((column) => column.cell?.(row) ?? {value: column.value?.(row) ?? "—"})
      ),
    [columns, visibleRows]
  );

  const onFilterValuesChange = useCallback((next: Record<string, unknown>): void => {
    setFilterValues(next);
  }, []);

  return {
    columns: tableColumns,
    data,
    filterValues,
    onFilterValuesChange,
    onSearchChange: searchText ? setSearch : undefined,
    rows: visibleRows,
    search,
    searchFields: searchText ? ["search"] : undefined,
    setSortColumn,
    sortColumn,
  };
};
