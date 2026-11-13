import {
  Box,
  Button,
  Card,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  type DataTableCustomComponentMap,
  Heading,
  IconButton,
  Link,
  Page,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {CommsStatCard} from "./comms/CommsStatCard";
import {unwrapAdminEnvelope, useAdminRpc, useAdminRpcQuery} from "./useAdminRpc";

export interface AnnouncementOverviewMetrics {
  impressions: number;
  acknowledgements: number;
  clicks: number;
}

export interface AnnouncementOverviewRow {
  _id: string;
  title: string;
  status: string;
  displayMode: string;
  audienceType: string;
  acknowledgementPolicy: string;
  metrics: AnnouncementOverviewMetrics;
}

export interface AnnouncementOverviewTotals {
  announcements: number;
  published: number;
  draft: number;
  archived: number;
  impressions: number;
  acknowledgements: number;
  clicks: number;
}

export interface AnnouncementOverviewResponse {
  data: AnnouncementOverviewRow[];
  totals: AnnouncementOverviewTotals;
  page: number;
  limit: number;
  total: number;
  more: boolean;
}

export interface AnnouncementOverviewProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  apiBase?: string;
  routeBase?: string;
  onCreate?: () => void;
  onEdit?: (id: string) => void;
  onOpenAcknowledgements?: () => void;
  onOpenImpressions?: () => void;
  onOpenClickEvents?: () => void;
}

const ANNOUNCEMENT_OVERVIEW_ROUTE = "/announcements/overview";
const DEFAULT_LIMIT = 20;
const ACTIONS_COLUMN_TYPE = "announcementOverviewActions";

const DATA_COLUMNS: DataTableColumn[] = [
  {columnType: "text", title: "Title", width: 200},
  {columnType: "text", title: "Status", width: 90},
  {columnType: "text", title: "Surface", width: 80},
  {columnType: "text", title: "Audience", width: 90},
  {columnType: "text", title: "Policy", width: 100},
  {columnType: "number", title: "Impressions", width: 100},
  {columnType: "number", title: "Acknowledgements", width: 120},
  {columnType: "number", title: "CTA clicks", width: 100},
];

const DATA_COLUMN_KEYS = [
  "title",
  "status",
  "displayMode",
  "audienceType",
  "acknowledgementPolicy",
  "impressions",
  "acknowledgements",
  "clicks",
] as const;

const OVERVIEW_TAGS = ["AnnouncementOverview", "admin_Announcement"] as const;

const formatCount = (value: number): string => {
  return Number.isFinite(value) ? String(value) : "0";
};

export const AnnouncementOverview: React.FC<AnnouncementOverviewProps> = ({
  baseUrl: _baseUrl,
  apiBase: _apiBase,
  routeBase: _routeBase,
  onCreate,
  onEdit,
  onOpenAcknowledgements,
  onOpenImpressions,
  onOpenClickEvents,
}) => {
  const [page, setPage] = useState(1);

  const rpc = useAdminRpc();
  const {
    data: overview,
    error,
    isLoading,
  } = useAdminRpcQuery<AnnouncementOverviewResponse>({
    // Paging keeps the table up while the next page loads.
    keepPreviousData: true,
    providesTags: OVERVIEW_TAGS,
    rpc,
    transformResponse: unwrapAdminEnvelope,
    url: `${ANNOUNCEMENT_OVERVIEW_ROUTE}?page=${page}&limit=${DEFAULT_LIMIT}`,
  });

  const ActionsCell: React.FC<{column: DataTableColumn; cellData: DataTableCellData}> = useCallback(
    ({cellData}: {column: DataTableColumn; cellData: DataTableCellData}) => {
      const {id} = cellData.value as {id: string};
      if (!onEdit) {
        return null;
      }
      return (
        <Box alignItems="center" direction="row" gap={1} justifyContent="end">
          <IconButton
            accessibilityLabel="Edit announcement"
            iconName="pen-to-square"
            onClick={() => onEdit(id)}
            tooltipText="Edit"
            variant="muted"
          />
        </Box>
      );
    },
    [onEdit]
  );

  const customColumnComponentMap: DataTableCustomComponentMap = useMemo(
    () => ({[ACTIONS_COLUMN_TYPE]: ActionsCell}),
    [ActionsCell]
  );

  const columns: DataTableColumn[] = [
    ...DATA_COLUMNS,
    ...(onEdit ? [{columnType: ACTIONS_COLUMN_TYPE, sortable: false, title: "", width: 60}] : []),
  ];

  const rows = ((overview?.data ?? []) as AnnouncementOverviewRow[]).map((row) => {
    const metrics = row.metrics ?? {acknowledgements: 0, clicks: 0, impressions: 0};
    const dataCells: DataTableCellData[] = DATA_COLUMN_KEYS.map((key) => {
      if (key === "impressions") {
        return {value: formatCount(metrics.impressions)};
      }
      if (key === "acknowledgements") {
        return {value: formatCount(metrics.acknowledgements)};
      }
      if (key === "clicks") {
        return {value: formatCount(metrics.clicks)};
      }
      return {value: row[key] ?? ""};
    });
    if (onEdit) {
      dataCells.push({value: {id: row._id}});
    }
    return dataCells;
  });

  const totalPages = overview ? Math.ceil(overview.total / DEFAULT_LIMIT) : 1;
  const totals = overview?.totals;

  return (
    <Page color="transparent" maxWidth="100%" padding={0}>
      <Box gap={4} padding={4}>
        <Box alignItems="center" direction="row" justifyContent="between">
          <Heading size="md">Announcements</Heading>
          {onCreate ? (
            <Button
              iconName="plus"
              onClick={onCreate}
              testID="announcement-overview-create-button"
              text="Create announcement"
              variant="primary"
            />
          ) : null}
        </Box>

        <Card color="base" padding={4}>
          <Box gap={2}>
            <Heading size="sm">Launch workflow</Heading>
            <Text color="secondaryDark" size="sm">
              Draft your announcement, choose audience, surface, acknowledgement policy, and
              platforms, preview the content in the editor, then publish when you are ready.
            </Text>
            <Text color="secondaryDark" size="sm">
              1. Create draft → 2. Target audience/surface/policy/platforms → 3. Preview → 4.
              Publish
            </Text>
          </Box>
        </Card>

        {isLoading ? (
          <Box
            alignItems="center"
            justifyContent="center"
            padding={6}
            testID="announcement-overview-loading"
          >
            <Spinner />
          </Box>
        ) : error ? (
          <Box alignItems="center" padding={6} testID="announcement-overview-error">
            <Text color="error">Failed to load announcement overview.</Text>
          </Box>
        ) : (
          <>
            <Box direction="row" gap={3} testID="announcement-overview-summary" wrap>
              <CommsStatCard
                label="Published"
                testID="announcement-overview-stat-published"
                value={formatCount(totals?.published ?? 0)}
              />
              <CommsStatCard
                label="Drafts"
                testID="announcement-overview-stat-drafts"
                value={formatCount(totals?.draft ?? 0)}
              />
              <CommsStatCard
                caption="All versions"
                label="Impressions"
                testID="announcement-overview-stat-impressions"
                value={formatCount(totals?.impressions ?? 0)}
              />
              <CommsStatCard
                caption="All versions"
                label="Acknowledgements"
                testID="announcement-overview-stat-acknowledgements"
                value={formatCount(totals?.acknowledgements ?? 0)}
              />
              <CommsStatCard
                caption="Primary action"
                label="CTA clicks"
                testID="announcement-overview-stat-clicks"
                value={formatCount(totals?.clicks ?? 0)}
              />
            </Box>

            {(onOpenAcknowledgements || onOpenImpressions || onOpenClickEvents) && (
              <Box direction="row" gap={3} wrap>
                {onOpenAcknowledgements ? (
                  <Link
                    onClick={onOpenAcknowledgements}
                    testID="announcement-overview-link-acknowledgements"
                    text="View acknowledgements table"
                  />
                ) : null}
                {onOpenImpressions ? (
                  <Link
                    onClick={onOpenImpressions}
                    testID="announcement-overview-link-impressions"
                    text="View impressions table"
                  />
                ) : null}
                {onOpenClickEvents ? (
                  <Link
                    onClick={onOpenClickEvents}
                    testID="announcement-overview-link-clicks"
                    text="View click events table"
                  />
                ) : null}
              </Box>
            )}

            {rows.length === 0 ? (
              <Box alignItems="center" padding={6} testID="announcement-overview-empty">
                <Text color="secondaryDark">
                  No announcements yet. Create your first announcement.
                </Text>
              </Box>
            ) : (
              <DataTable
                columns={columns}
                customColumnComponentMap={customColumnComponentMap}
                data={rows}
                page={page}
                setPage={setPage}
                totalPages={totalPages}
              />
            )}
          </>
        )}
      </Box>
    </Page>
  );
};
