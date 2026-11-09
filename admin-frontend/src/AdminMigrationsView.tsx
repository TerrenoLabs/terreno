import {Banner, Box, Button, Card, Heading, Spinner, Text} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useEffect, useRef, useState} from "react";
import type {AdminConfigResponse, BackgroundTask} from "./types";
import {useAdminMigrations} from "./useAdminMigrations";
import {useAdminScripts} from "./useAdminScripts";

const POLL_INTERVAL_MS = 1000;

const isTerminalStatus = (status?: string): boolean => {
  return status === "completed" || status === "failed" || status === "cancelled";
};

const formatAppliedAt = (value: string | undefined): string => {
  if (!value) {
    return "";
  }
  const parsed = DateTime.fromISO(value);
  if (!parsed.isValid) {
    return value;
  }
  return parsed.toUTC().toFormat("yyyy-LL-dd HH:mm:ss 'UTC'");
};

export interface AdminMigrationsViewProps {
  apiBase: string;
  config: AdminConfigResponse | null;
  configError: unknown;
  isConfigLoading: boolean;
}

export const AdminMigrationsView: React.FC<AdminMigrationsViewProps> = ({
  apiBase,
  config,
  configError,
  isConfigLoading,
}) => {
  const migrationsEnabled = Boolean(config?.migrations?.enabled);
  const {useGetMigrationsQuery, useRunMigrationsMutation} = useAdminMigrations(apiBase);
  const scripts = useAdminScripts(apiBase);
  const useGetScriptTaskQuery =
    typeof scripts.useGetScriptTaskQuery === "function"
      ? scripts.useGetScriptTaskQuery
      : () => ({data: undefined, error: null, isLoading: false});
  const {
    data: status,
    error: statusError,
    isLoading: isStatusLoading,
    refetch,
  } = useGetMigrationsQuery(undefined, {skip: !migrationsEnabled});
  const [runMigrations, {isLoading: isStarting}] = useRunMigrationsMutation();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [runKind, setRunKind] = useState<"dry" | "wet" | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const taskStatusRef = useRef<string | undefined>(undefined);
  const taskPollErrorRef = useRef(false);

  const {data: taskPayload, error: taskPollError} = useGetScriptTaskQuery(taskId ?? "", {
    pollingInterval:
      taskId && !isTerminalStatus(taskStatusRef.current) && !taskPollErrorRef.current
        ? POLL_INTERVAL_MS
        : 0,
    skip: !taskId,
  });
  const task = taskPayload?.task as BackgroundTask | undefined;
  taskStatusRef.current = task?.status;
  taskPollErrorRef.current = Boolean(taskPollError);

  // Refresh status after a batch finishes so applied/pending lists match history.
  // Depend on status string, not the task object, so later polls do not refetch.
  useEffect(() => {
    if (!taskId || !isTerminalStatus(task?.status) || !refetch) {
      return;
    }
    void refetch();
  }, [refetch, task?.status, taskId]);

  const handleRun = useCallback(
    async (wetRun: boolean): Promise<void> => {
      setRunKind(wetRun ? "wet" : "dry");
      setTaskId(null);
      taskStatusRef.current = undefined;
      taskPollErrorRef.current = false;
      setStartError(null);
      try {
        const result = await runMigrations({wetRun}).unwrap();
        setTaskId(result.taskId);
      } catch (err: unknown) {
        const errData = (err as {data?: {title?: string; detail?: string}})?.data;
        setStartError(errData?.detail ?? errData?.title ?? "Failed to start migrations");
      }
    },
    [runMigrations]
  );

  const handleDryRun = useCallback((): void => {
    void handleRun(false);
  }, [handleRun]);

  const handleApply = useCallback((): void => {
    void handleRun(true);
  }, [handleRun]);

  if (isConfigLoading) {
    return (
      <Box
        alignItems="center"
        justifyContent="center"
        padding={6}
        testID="admin-migrations-loading"
      >
        <Spinner />
      </Box>
    );
  }

  if (configError || !config) {
    return (
      <Box padding={4} testID="admin-migrations-config-error">
        <Text color="error">Failed to load admin configuration.</Text>
      </Box>
    );
  }

  if (!migrationsEnabled) {
    return (
      <Box testID="admin-migrations">
        <Text>Migrations are not configured on this server.</Text>
      </Box>
    );
  }

  const pending = status?.pending ?? [];
  const applied = status?.applied ?? [];
  const canRunMigrations = config.platformTools?.runScripts ?? true;
  const pollFailed = Boolean(taskId && taskPollError);
  const isBusy =
    isStarting || Boolean(taskId && !pollFailed && (!task || !isTerminalStatus(task.status)));

  return (
    <Box gap={4} testID="admin-migrations">
      {isStatusLoading ? (
        <Spinner />
      ) : statusError ? (
        <Text color="error">Failed to load migration status.</Text>
      ) : (
        <>
          <Card padding={4} testID="admin-migrations-pending">
            <Heading size="sm">Pending</Heading>
            {pending.length === 0 ? (
              <Text color="secondaryDark">No pending migrations.</Text>
            ) : (
              pending.map((item) => <Text key={item.id}>{item.id}</Text>)
            )}
          </Card>
          <Card padding={4} testID="admin-migrations-applied">
            <Heading size="sm">Applied</Heading>
            {applied.length === 0 ? (
              <Text color="secondaryDark">None applied yet.</Text>
            ) : (
              applied.map((item) => {
                const appliedAtLabel = formatAppliedAt(item.appliedAt);
                return (
                  <Text key={item.id}>
                    {item.id}
                    {appliedAtLabel ? ` · ${appliedAtLabel}` : ""}
                  </Text>
                );
              })
            )}
          </Card>
          {status?.lock ? (
            <Banner
              id="admin-migrations-lock"
              status="warning"
              text={`Lock held by ${status.lock.holder}`}
            />
          ) : null}
        </>
      )}
      <Box direction="row" gap={2} wrap>
        <Button
          disabled={isBusy || !canRunMigrations}
          onClick={handleDryRun}
          testID="admin-migrations-dry-run"
          text="Dry run"
          variant="outline"
        />
        <Button
          disabled={isBusy || !canRunMigrations || pending.length === 0}
          onClick={handleApply}
          testID="admin-migrations-apply"
          text="Apply pending"
          variant="primary"
        />
      </Box>
      {startError ? (
        <Text color="error" testID="admin-migrations-start-error">
          {startError}
        </Text>
      ) : null}
      {pollFailed ? (
        <Text color="error" testID="admin-migrations-task-error">
          Failed to load migration task status.
        </Text>
      ) : null}
      {task ? (
        <Card padding={4} testID="admin-migrations-task">
          <Text>
            {runKind === "wet" ? "Apply" : "Dry run"} {task.status}
            {task.error ? `: ${task.error}` : ""}
          </Text>
          {(task.logs ?? []).map((log, index) => (
            <Text key={`${log.timestamp}-${index}`}>{log.message}</Text>
          ))}
          {(task.result ?? []).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Card>
      ) : null}
    </Box>
  );
};
