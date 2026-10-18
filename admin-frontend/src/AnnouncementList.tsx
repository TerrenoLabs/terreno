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
import {DateTime} from "luxon";
import React, {useCallback, useMemo, useState} from "react";
import {resolveAdminBases} from "./types";
import {useAdminModelApi} from "./useAdminModelApi";

interface AnnouncementListProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  onCreateNew?: () => void;
  onRowClick?: (id: string) => void;
}

/** Row shape returned by the announcements list endpoint. */
interface AnnouncementListItem {
  _id: string;
  title?: string;
  status?: string;
  displayMode?: string;
  audienceType?: string;
  acknowledgementPolicy?: string;
  priority?: number;
  version?: number;
  publishedAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

const DEFAULT_LIMIT = 20;

const ACTIONS_COLUMN_TYPE = "announcementActions";

const DATA_COLUMNS: DataTableColumn[] = [
  {columnType: "text", sortable: true, title: "Title", width: 200},
  {columnType: "text", sortable: true, title: "Status", width: 90},
  {columnType: "text", sortable: true, title: "Display", width: 80},
  {columnType: "text", sortable: true, title: "Audience", width: 90},
  {columnType: "text", sortable: true, title: "Policy", width: 100},
  {columnType: "number", sortable: true, title: "Priority", width: 80},
  {columnType: "number", sortable: true, title: "Version", width: 80},
  {columnType: "text", sortable: true, title: "Published", width: 140},
  {columnType: "text", sortable: true, title: "Expires", width: 140},
];

const DATA_COLUMN_KEYS = [
  "title",
  "status",
  "displayMode",
  "audienceType",
  "acknowledgementPolicy",
  "priority",
  "version",
  "publishedAt",
  "expiresAt",
];

const formatDateCell = (value: unknown): string => {
  if (!value) {
    return "";
  }
  const parsed = DateTime.fromISO(String(value));
  if (!parsed.isValid) {
    return String(value);
  }
  return parsed.toLocaleString(DateTime.DATETIME_MED);
};

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

export const AnnouncementList: React.FC<AnnouncementListProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  onCreateNew,
  onRowClick,
}) => {
  const {apiBase: resolvedApiBase} = resolveAdminBases({apiBase, baseUrl, routeBase});
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<ColumnSortInterface | undefined>();

  const routePath = `${resolvedApiBase}/announcements`;
  const {useListQuery} = useAdminModelApi(routePath, "Announcement");

  const sortString = buildSortString(sortColumn) ?? "-priority,-publishedAt";

  const {
    data: listData,
    isLoading,
    error,
  } = useListQuery({
    limit: DEFAULT_LIMIT,
    page,
    sort: sortString,
  });

  const ActionsCell: React.FC<{column: DataTableColumn; cellData: DataTableCellData}> = useCallback(
    ({cellData}: {column: DataTableColumn; cellData: DataTableCellData}) => {
      const {id} = cellData.value as {id: string};
      if (!onRowClick) {
        return null;
      }
      return (
        <Box alignItems="center" direction="row" gap={1} justifyContent="end">
          <IconButton
            accessibilityLabel="Edit"
            iconName="pen-to-square"
            onClick={() => onRowClick(id)}
            tooltipText="Edit"
            variant="muted"
          />
        </Box>
      );
    },
    [onRowClick]
  );

  const customColumnComponentMap: DataTableCustomComponentMap = useMemo(
    () => ({[ACTIONS_COLUMN_TYPE]: ActionsCell}),
    [ActionsCell]
  );

  const columns: DataTableColumn[] = [
    ...DATA_COLUMNS,
    ...(onRowClick
      ? [{columnType: ACTIONS_COLUMN_TYPE, sortable: false, title: "", width: 60}]
      : []),
  ];

  const rows = ((listData?.data ?? []) as AnnouncementListItem[]).map((item) => {
    const dataCells = DATA_COLUMN_KEYS.map((key) => {
      const value = item[key];
      if (key === "publishedAt" || key === "expiresAt") {
        return {value: formatDateCell(value)};
      }
      if (key === "priority" || key === "version") {
        return {value: typeof value === "number" ? String(value) : (value ?? "0")};
      }
      return {value: value ?? ""};
    });
    if (onRowClick) {
      dataCells.push({value: {id: item._id}});
    }
    return dataCells;
  });

  const totalPages = listData ? Math.ceil(listData.total / DEFAULT_LIMIT) : 1;

  return (
    <Page color="transparent" maxWidth="100%" padding={0}>
      <Box alignItems="center" direction="row" justifyContent="between" padding={3}>
        <Text size="lg">Announcements</Text>
        {onCreateNew && (
          <Button
            onClick={onCreateNew}
            testID="announcement-list-create-button"
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
          <Text color="error">Failed to load announcements.</Text>
        </Box>
      ) : rows.length === 0 ? (
        <Box alignItems="center" padding={6}>
          <Text color="secondaryDark">No announcements found.</Text>
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
