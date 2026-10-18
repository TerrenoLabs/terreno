import {
  Box,
  Button,
  Card,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  DateTimeField,
  Heading,
  IconButton,
  SelectField,
  Spinner,
  Text,
  TextField,
  useToast,
} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import {AdminScreenPage} from "../AdminScreenPage";
import {CommsStatCard} from "../comms/CommsStatCard";
import {JobsStatusBadge} from "./JobsStatusBadge";
import {formatJobTimestamp, type JobRow, type JobScheduleRow, jobRowId} from "./jobPayload";
import type {JobsDashboardFilters} from "./jobsDashboardParams";
import {useJobsDashboardApi} from "./useJobsDashboardApi";

const LIST_LIMIT = 20;
const ALL_OPTION = {label: "All", value: ""};

const STATUS_OPTIONS = [
  ALL_OPTION,
  {label: "Pending", value: "pending"},
  {label: "Scheduled", value: "scheduled"},
  {label: "Running", value: "running"},
  {label: "Failed", value: "failed"},
  {label: "Dead", value: "dead"},
  {label: "Completed", value: "completed"},
  {label: "Cancelled", value: "cancelled"},
];

const COLUMNS: DataTableColumn[] = [
  {columnType: "date", title: "Created", width: 160},
  {columnType: "text", title: "Name", width: 160},
  {columnType: "jobsStatus", title: "Status", width: 110},
  {columnType: "number", title: "Attempts", width: 90},
  {columnType: "text", title: "Last error", width: 180},
  {columnType: "date", title: "Run at", width: 160},
  {columnType: "jobsActions", title: "", width: 72},
];

export interface JobsDashboardScreenProps {
  filters: JobsDashboardFilters;
  onFiltersChange: (next: JobsDashboardFilters) => void;
  routeBase?: string;
}

const SummaryCards: React.FC<{
  deadTotal: number;
  failedTotal: number;
  pendingTotal: number;
  runningTotal: number;
}> = ({deadTotal, failedTotal, pendingTotal, runningTotal}) => {
  return (
    <Box alignItems="stretch" direction="row" gap={3} testID="jobs-dashboard-stats" wrap>
      <CommsStatCard
        label="Dead"
        testID="jobs-stat-dead"
        tone={deadTotal > 0 ? "alert" : "neutral"}
        value={String(deadTotal)}
      />
      <CommsStatCard label="Running" testID="jobs-stat-running" value={String(runningTotal)} />
      <CommsStatCard
        label="Failed"
        testID="jobs-stat-failed"
        tone={failedTotal > 0 ? "alert" : "neutral"}
        value={String(failedTotal)}
      />
      <CommsStatCard label="Pending" testID="jobs-stat-pending" value={String(pendingTotal)} />
    </Box>
  );
};

const ScheduleRow: React.FC<{
  onPause: (name: string) => Promise<void>;
  onResume: (name: string) => Promise<void>;
  pauseLoading: boolean;
  resumeLoading: boolean;
  schedule: JobScheduleRow;
}> = ({onPause, onResume, pauseLoading, resumeLoading, schedule}) => {
  const handleToggle = useCallback(async (): Promise<void> => {
    if (schedule.enabled) {
      await onPause(schedule.name);
      return;
    }
    await onResume(schedule.name);
  }, [onPause, onResume, schedule.enabled, schedule.name]);

  return (
    <Box
      alignItems="center"
      direction="row"
      gap={3}
      justifyContent="between"
      paddingY={2}
      testID={`jobs-schedule-${schedule.name}`}
      wrap
    >
      <Box flex="grow" gap={1} minWidth={200}>
        <Text bold>{schedule.name}</Text>
        <Text color="secondaryDark" size="sm">
          {`${schedule.cron ?? "—"} · ${schedule.timezone ?? "UTC"}`}
        </Text>
        <Text color="secondaryDark" size="sm">
          {`Next run ${formatJobTimestamp({empty: "—", value: schedule.nextRunAt})}`}
        </Text>
      </Box>
      <Button
        loading={schedule.enabled ? pauseLoading : resumeLoading}
        onClick={handleToggle}
        testID={`jobs-schedule-toggle-${schedule.name}`}
        text={schedule.enabled ? "Pause" : "Resume"}
        variant={schedule.enabled ? "secondary" : "primary"}
        withConfirmation
      />
    </Box>
  );
};

export const JobsDashboardScreen: React.FC<JobsDashboardScreenProps> = ({
  filters,
  onFiltersChange,
  routeBase = "/admin",
}) => {
  const toast = useToast();
  const [scheduleAction, setScheduleAction] = useState<string | undefined>();
  const {
    useListQuery,
    usePauseScheduleMutation,
    useResumeScheduleMutation,
    useSchedulesQuery,
    useStatsQuery,
  } = useJobsDashboardApi();
  const page = filters.page ?? 1;
  const listParams = useMemo(
    () => ({
      end: filters.end,
      limit: LIST_LIMIT,
      name: filters.name,
      page,
      q: filters.q,
      scheduleId: filters.scheduleId,
      start: filters.start,
      status: filters.status,
    }),
    [filters, page]
  );
  const {data, error, isLoading} = useListQuery(listParams);
  const {data: statsData, error: statsError, isLoading: statsLoading} = useStatsQuery();
  const {
    data: schedulesData,
    error: schedulesError,
    isLoading: schedulesLoading,
  } = useSchedulesQuery();
  const [pauseSchedule, pauseState] = usePauseScheduleMutation();
  const [resumeSchedule, resumeState] = useResumeScheduleMutation();
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const schedules = schedulesData ?? [];
  const statusCounts = statsData?.byStatus ?? {};
  const scheduleOptions = useMemo(
    () => [
      ALL_OPTION,
      ...schedules.map((schedule) => ({
        label: schedule.name,
        value: schedule.id ?? schedule._id ?? "",
      })),
    ],
    [schedules]
  );
  const hasActiveFilters = Boolean(
    filters.end ||
      filters.name ||
      filters.q ||
      filters.scheduleId ||
      filters.start ||
      filters.status
  );

  const filterSetter = useCallback(
    (key: keyof JobsDashboardFilters) =>
      (value: string): void => {
        onFiltersChange({
          ...filters,
          page: 1,
          [key]: value || undefined,
        });
      },
    [filters, onFiltersChange]
  );

  const openJob = useCallback(
    (id: string): void => {
      router.push(`${routeBase}/jobs/${id}` as Href);
    },
    [routeBase]
  );

  const clearFilters = useCallback((): void => {
    onFiltersChange({page: 1});
  }, [onFiltersChange]);

  const handlePauseSchedule = useCallback(
    async (name: string): Promise<void> => {
      setScheduleAction(name);
      try {
        await pauseSchedule(name).unwrap();
        toast.success(`Paused schedule ${name}`);
      } catch (pauseError: unknown) {
        toast.catch(pauseError, "Pause schedule failed");
      } finally {
        setScheduleAction(undefined);
      }
    },
    [pauseSchedule, toast]
  );

  const handleResumeSchedule = useCallback(
    async (name: string): Promise<void> => {
      setScheduleAction(name);
      try {
        await resumeSchedule(name).unwrap();
        toast.success(`Resumed schedule ${name}`);
      } catch (resumeError: unknown) {
        toast.catch(resumeError, "Resume schedule failed");
      } finally {
        setScheduleAction(undefined);
      }
    },
    [resumeSchedule, toast]
  );

  const tableData = useMemo((): DataTableCellData[][] => {
    return rows.map((row: JobRow) => [
      {value: formatJobTimestamp({value: row.created})},
      {value: row.name},
      {value: row.status},
      {value: row.attemptCount ?? 0},
      {value: row.lastError ?? ""},
      {value: formatJobTimestamp({value: row.runAt})},
      {
        value: {
          onOpen: () => openJob(jobRowId(row)),
        },
      },
    ]);
  }, [openJob, rows]);

  const customColumnComponentMap = useMemo(
    () => ({
      jobsActions: ({cellData}: {cellData: DataTableCellData}) => {
        const value = cellData.value as {onOpen: () => void};
        return (
          <IconButton
            accessibilityLabel="Open job"
            iconName="eye"
            onClick={value.onOpen}
            testID="jobs-row-open"
            variant="muted"
          />
        );
      },
      jobsStatus: ({cellData}: {cellData: DataTableCellData}) => (
        <JobsStatusBadge status={String(cellData.value ?? "")} />
      ),
    }),
    []
  );

  return (
    <AdminScreenPage
      backHref={routeBase}
      color="transparent"
      maxWidth="100%"
      padding={0}
      scroll
      title="Jobs"
    >
      <Box gap={4} padding={4} testID="jobs-dashboard">
        {statsLoading ? (
          <Box alignItems="center" padding={4} testID="jobs-stats-loading">
            <Spinner />
          </Box>
        ) : null}
        {statsError ? (
          <Text color="error" testID="jobs-stats-error">
            Failed to load job counts.
          </Text>
        ) : null}
        {!statsLoading && !statsError ? (
          <SummaryCards
            deadTotal={statusCounts.dead ?? 0}
            failedTotal={statusCounts.failed ?? 0}
            pendingTotal={statusCounts.pending ?? 0}
            runningTotal={statusCounts.running ?? 0}
          />
        ) : null}
        <Card padding={4}>
          <Box gap={4}>
            <Box alignItems="center" direction="row" gap={3} justifyContent="between" wrap>
              <Box gap={1}>
                <Heading size="sm">Filter jobs</Heading>
                <Text color="secondaryDark" size="sm">
                  Narrow results by status, handler name, schedule, or date.
                </Text>
              </Box>
              {hasActiveFilters ? (
                <Button
                  onClick={clearFilters}
                  testID="jobs-clear-filters"
                  text="Clear filters"
                  variant="muted"
                />
              ) : null}
            </Box>
            <Box alignItems="stretch" direction="row" gap={3} wrap>
              <Box flex="grow" minWidth={150}>
                <SelectField
                  onChange={filterSetter("status")}
                  options={STATUS_OPTIONS}
                  testID="jobs-filter-status"
                  title="Status"
                  value={filters.status ?? ""}
                />
              </Box>
              <Box flex="grow" minWidth={150}>
                <TextField
                  onChange={filterSetter("name")}
                  testID="jobs-filter-name"
                  title="Handler name"
                  value={filters.name ?? ""}
                />
              </Box>
              <Box flex="grow" minWidth={180}>
                <SelectField
                  onChange={filterSetter("scheduleId")}
                  options={scheduleOptions}
                  testID="jobs-filter-schedule"
                  title="Schedule"
                  value={filters.scheduleId ?? ""}
                />
              </Box>
              <Box flex="grow" minWidth={220}>
                <TextField
                  iconName="magnifying-glass"
                  onChange={filterSetter("q")}
                  testID="jobs-filter-q"
                  title="Search"
                  value={filters.q ?? ""}
                />
              </Box>
            </Box>
            <Box alignItems="stretch" direction="row" gap={3} wrap>
              <Box flex="grow" minWidth={280}>
                <DateTimeField
                  onChange={filterSetter("start")}
                  testID="jobs-filter-start"
                  title="Start"
                  type="datetime"
                  value={filters.start ?? ""}
                />
              </Box>
              <Box flex="grow" minWidth={280}>
                <DateTimeField
                  onChange={filterSetter("end")}
                  testID="jobs-filter-end"
                  title="End"
                  type="datetime"
                  value={filters.end ?? ""}
                />
              </Box>
            </Box>
          </Box>
        </Card>
        <Card padding={4} testID="jobs-schedules-card">
          <Box gap={3}>
            <Heading size="sm">Schedules</Heading>
            {schedulesLoading ? (
              <Box alignItems="center" padding={4} testID="jobs-schedules-loading">
                <Spinner />
              </Box>
            ) : null}
            {schedulesError ? (
              <Text color="error" testID="jobs-schedules-error">
                Failed to load schedules.
              </Text>
            ) : null}
            {!schedulesLoading && !schedulesError && schedules.length === 0 ? (
              <Text color="secondaryDark" testID="jobs-schedules-empty">
                No recurring schedules are defined.
              </Text>
            ) : null}
            {!schedulesLoading && !schedulesError
              ? schedules.map((schedule) => (
                  <ScheduleRow
                    key={schedule.name}
                    onPause={handlePauseSchedule}
                    onResume={handleResumeSchedule}
                    pauseLoading={pauseState.isLoading && scheduleAction === schedule.name}
                    resumeLoading={resumeState.isLoading && scheduleAction === schedule.name}
                    schedule={schedule}
                  />
                ))
              : null}
          </Box>
        </Card>
        <Box gap={1}>
          <Heading size="sm">Job queue</Heading>
          <Text color="secondaryDark" size="sm" testID="jobs-result-count">
            {`${total} matching job${total === 1 ? "" : "s"}`}
          </Text>
        </Box>
        {isLoading ? (
          <Box alignItems="center" padding={6} testID="jobs-dashboard-loading">
            <Spinner />
          </Box>
        ) : null}
        {error ? (
          <Text color="error" testID="jobs-dashboard-error">
            Failed to load jobs.
          </Text>
        ) : null}
        {!isLoading && !error && rows.length === 0 ? (
          <Card padding={6} testID="jobs-dashboard-empty">
            <Box alignItems="center" gap={2}>
              <Heading size="sm">No jobs found</Heading>
              <Text color="secondaryDark">
                {hasActiveFilters
                  ? "Clear or adjust the filters to see more jobs."
                  : "Background jobs will appear here as they are enqueued."}
              </Text>
            </Box>
          </Card>
        ) : null}
        {!isLoading && !error && rows.length > 0 ? (
          <DataTable
            columns={COLUMNS}
            customColumnComponentMap={customColumnComponentMap}
            data={tableData}
            page={page}
            setPage={(nextPage) => onFiltersChange({...filters, page: nextPage})}
            testID="jobs-dashboard-table"
            totalPages={Math.max(1, Math.ceil(total / LIST_LIMIT))}
          />
        ) : null}
      </Box>
    </AdminScreenPage>
  );
};
