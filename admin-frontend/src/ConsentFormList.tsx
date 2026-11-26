import {
  Box,
  Button,
  type ColumnSortInterface,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  type DataTableCustomComponentMap,
  IconButton,
  Page,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useCallback, useMemo, useRef, useState} from "react";
import {resolveAdminBases} from "./types";
import {useAdminModelApi} from "./useAdminModelApi";

interface ConsentFormListProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  onCreateNew?: () => void;
  onRowClick?: (id: string) => void;
}

/** Row shape returned by the consent forms list endpoint. */
interface ConsentFormListItem {
  _id: string;
  title?: string;
  type?: string;
  version?: number;
  active?: boolean;
  order?: number;
  [key: string]: unknown;
}

const DEFAULT_LIMIT = 20;

const ACTIONS_COLUMN_TYPE = "consentFormActions";

const DATA_COLUMNS: DataTableColumn[] = [
  {columnType: "text", sortable: true, title: "Title", width: 250},
  {columnType: "text", sortable: true, title: "Type", width: 120},
  {columnType: "number", sortable: true, title: "Version", width: 100},
  {columnType: "boolean", sortable: true, title: "Active", width: 100},
  {columnType: "number", sortable: true, title: "Order", width: 100},
];

const DATA_COLUMN_KEYS = ["title", "type", "version", "active", "order"];

const buildSortString = (sort: ColumnSortInterface | undefined): string | undefined => {
  if (!sort) {
    return undefined;
  }
  const fieldKey = DATA_COLUMN_KEYS[sort.column];
  if (!fieldKey) {
    return undefined;
  }
  return sort.direction === "desc" ? `-${fieldKey}` : fieldKey;
};

export const ConsentFormList: React.FC<ConsentFormListProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  onCreateNew,
  onRowClick,
}) => {
  const {apiBase: resolvedApiBase} = resolveAdminBases({apiBase, baseUrl, routeBase});
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<ColumnSortInterface | undefined>();

  const routePath = `${resolvedApiBase}/consent-forms`;
  const {useListQuery} = useAdminModelApi(routePath, "ConsentForm");

  const sortString = buildSortString(sortColumn) ?? "-created";

  const {
    data: listData,
    isLoading,
    error,
  } = useListQuery({
    limit: DEFAULT_LIMIT,
    page,
    sort: sortString,
  });

  // Callers pass an inline `onRowClick`. The cell reads it through a ref so the cell component
  // keeps its identity; a new component type would remount every action cell in the table.
  const onRowClickRef = useRef(onRowClick);
  onRowClickRef.current = onRowClick;
  const hasRowClick = Boolean(onRowClick);

  const ActionsCell: React.FC<{column: DataTableColumn; cellData: DataTableCellData}> = useCallback(
    ({cellData}: {column: DataTableColumn; cellData: DataTableCellData}) => {
      const {id} = cellData.value as {id: string};
      if (!hasRowClick) {
        return null;
      }
      return (
        <Box alignItems="center" direction="row" gap={1} justifyContent="end">
          <IconButton
            accessibilityLabel="Edit"
            iconName="pen-to-square"
            onClick={() => onRowClickRef.current?.(id)}
            tooltipText="Edit"
            variant="muted"
          />
        </Box>
      );
    },
    [hasRowClick]
  );

  const customColumnComponentMap: DataTableCustomComponentMap = useMemo(
    () => ({[ACTIONS_COLUMN_TYPE]: ActionsCell}),
    [ActionsCell]
  );

  const columns: DataTableColumn[] = useMemo(
    () => [
      ...DATA_COLUMNS,
      ...(hasRowClick
        ? [{columnType: ACTIONS_COLUMN_TYPE, sortable: false, title: "", width: 60}]
        : []),
    ],
    [hasRowClick]
  );

  // Built once per fetched page so the table's memoized rows and cells keep their props.
  const listItems = listData?.data;
  const rows = useMemo(
    () =>
      ((listItems ?? []) as ConsentFormListItem[]).map((item) => {
        const dataCells = DATA_COLUMN_KEYS.map((key) => {
          const value = item[key];
          if (key === "active") {
            return {value: Boolean(value)};
          }
          if (key === "version" || key === "order") {
            return {value: typeof value === "number" ? String(value) : (value ?? "0")};
          }
          return {value: value ?? ""};
        });
        if (hasRowClick) {
          dataCells.push({value: {id: item._id}});
        }
        return dataCells;
      }),
    [hasRowClick, listItems]
  );

  const totalPages = listData ? Math.ceil(listData.total / DEFAULT_LIMIT) : 1;

  return (
    <Page color="transparent" maxWidth="100%" padding={0}>
      <Box alignItems="center" direction="row" justifyContent="between" padding={3}>
        <Text size="lg">Consent Forms</Text>
        {onCreateNew && (
          <Button
            onClick={onCreateNew}
            testID="consent-form-list-create-button"
            text="Create New"
            variant="primary"
          />
        )}
      </Box>
      {isLoading ? (
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      ) : error ? (
        <Box alignItems="center" padding={6}>
          <Text color="error">Failed to load consent forms.</Text>
        </Box>
      ) : rows.length === 0 ? (
        <Box alignItems="center" padding={6}>
          <Text color="secondaryDark">No consent forms found.</Text>
        </Box>
      ) : (
        <DataTable
          columns={columns}
          customColumnComponentMap={customColumnComponentMap}
          data={rows}
          page={page}
          setPage={setPage}
          setSortColumn={setSortColumn}
          sortColumn={sortColumn}
          totalPages={totalPages}
        />
      )}
    </Page>
  );
};
