import {DateTime} from "luxon";
import React, {useMemo} from "react";

import {Box} from "./Box";
import type {DataTableColumn} from "./Common";
import {DataTable} from "./DataTable";
import {DateTimeField} from "./DateTimeField";
import {Heading} from "./Heading";
import {MultiselectField} from "./MultiselectField";
import {Pagination} from "./Pagination";
import {Spinner} from "./Spinner";
import {Text} from "./Text";

export interface AIRequestExplorerData {
  aiModel: string;
  created: string;
  error?: string;
  prompt: string;
  requestType: string;
  response?: string;
  responseTime?: number;
  tokensUsed?: number;
  user?: {email?: string; name?: string};
}

export interface AIRequestExplorerProps {
  data: AIRequestExplorerData[];
  endDate?: string;
  isLoading?: boolean;
  onEndDateChange?: (date: string) => void;
  onPageChange: (page: number) => void;
  onRequestTypeFilterChange?: (types: string[]) => void;
  onStartDateChange?: (date: string) => void;
  page: number;
  requestTypeFilter?: string[];
  startDate?: string;
  testID?: string;
  totalCount: number;
  totalPages: number;
}

const REQUEST_TYPE_OPTIONS = [
  {label: "General", value: "general"},
  {label: "Remix", value: "remix"},
  {label: "Summarization", value: "summarization"},
  {label: "Translation", value: "translation"},
];

const COLUMNS: DataTableColumn[] = [
  {columnType: "text", title: "Type", width: 120},
  {columnType: "text", title: "Model", width: 150},
  {columnType: "text", title: "User", width: 150},
  {columnType: "text", title: "Prompt", width: 250},
  {columnType: "text", title: "Response", width: 250},
  {columnType: "number", title: "Tokens", width: 80},
  {columnType: "text", title: "Time (ms)", width: 100},
  {columnType: "text", title: "Created", width: 180},
  {columnType: "text", title: "Error", width: 150},
];

const formatRow = (item: AIRequestExplorerData) => {
  return [
    {value: item.requestType},
    {value: item.aiModel},
    {value: item.user?.name ?? item.user?.email ?? "-"},
    {value: item.prompt ?? "-"},
    {value: item.response ?? "-"},
    {value: item.tokensUsed?.toString() ?? "-"},
    {value: item.responseTime != null ? `${item.responseTime}ms` : "-"},
    {
      value: item.created
        ? DateTime.fromISO(item.created).toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS)
        : "-",
    },
    {value: item.error ?? ""},
  ];
};

export const AIRequestExplorer = ({
  data,
  endDate,
  isLoading = false,
  onEndDateChange,
  onPageChange,
  onRequestTypeFilterChange,
  onStartDateChange,
  page,
  requestTypeFilter,
  startDate,
  testID,
  totalCount,
  totalPages,
}: AIRequestExplorerProps): React.ReactElement => {
  // DataTable is memoized on `data`; formatting inline would hand it new rows on every
  // render and re-render every cell when only a filter or the page changed.
  const rows = useMemo(() => data.map(formatRow), [data]);

  return (
    <Box direction="column" flex="grow" gap={4} padding={4} testID={testID}>
      <Heading size="lg">AI Request Explorer</Heading>
      <Text color="secondaryDark" size="sm">
        {totalCount} total requests
      </Text>

      {/* Filters */}
      <Box direction="row" gap={3} wrap>
        {onRequestTypeFilterChange ? (
          <Box minWidth={200}>
            <MultiselectField
              onChange={onRequestTypeFilterChange}
              options={REQUEST_TYPE_OPTIONS}
              title="Request Type"
              value={requestTypeFilter ?? []}
            />
          </Box>
        ) : null}
        {onStartDateChange ? (
          <Box minWidth={200}>
            <DateTimeField
              onChange={onStartDateChange}
              title="Start Date"
              type="datetime"
              value={startDate ?? ""}
            />
          </Box>
        ) : null}
        {onEndDateChange ? (
          <Box minWidth={200}>
            <DateTimeField
              onChange={onEndDateChange}
              title="End Date"
              type="datetime"
              value={endDate ?? ""}
            />
          </Box>
        ) : null}
      </Box>

      {/* Table */}
      {isLoading ? (
        <Box alignItems="center" padding={6}>
          <Spinner />
        </Box>
      ) : (
        <DataTable alternateRowBackground columns={COLUMNS} data={rows} />
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <Box alignItems="center">
          <Pagination page={page} setPage={onPageChange} totalPages={totalPages} />
        </Box>
      ) : null}
    </Box>
  );
};
