import {
  Badge,
  Banner,
  Box,
  Button,
  Heading,
  Icon,
  type IconName,
  Modal,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  buildExport,
  formatDuration,
  isErrorLine,
  relativeTime,
  statusMeta,
  summarizeOutput,
} from "./scriptRunUtils";
import {type BackgroundTask, resolveAdminBases} from "./types";
import {useAdminScripts} from "./useAdminScripts";

interface AdminScriptRunModalProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  scriptName: string | null;
  scriptDescription?: string;
  visible: boolean;
  onDismiss: () => void;
  /** When true, skip the confirmation step and only allow a dry run. */
  dryRunOnly?: boolean;
  /**
   * When set, the modal opens read-only on a previously-recorded run (from the run
   * history) instead of starting a new one.
   */
  historyTaskId?: string;
}

const POLL_INTERVAL_MS = 2000;

const isTerminalStatus = (status?: string): boolean =>
  status === "completed" || status === "failed" || status === "cancelled";

type Phase = "confirm" | "running" | "done";

type OutputFilter = "all" | "errors";

const downloadFile = (filename: string, content: string, mimeType: string): void => {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([content], {type: mimeType});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** Small labelled count with an icon, used in the run summary. */
const CountStat: React.FC<{
  iconColor: "success" | "error" | "secondaryDark";
  iconName: IconName;
  label: string;
  value: number;
}> = ({iconColor, iconName, label, value}) => (
  <Box gap={1}>
    <Box alignItems="center" direction="row" gap={2}>
      <Icon color={iconColor} iconName={iconName} size="sm" />
      <Heading size="sm">{value.toLocaleString()}</Heading>
    </Box>
    <Text color="secondaryDark" size="sm">
      {label}
    </Text>
  </Box>
);

/** Proportional success/error bar mirroring the prototype's segment bar. */
const SegmentBar: React.FC<{errorCount: number; successCount: number; total: number}> = ({
  errorCount,
  successCount,
  total,
}) => {
  if (total <= 0) {
    return null;
  }
  const successPct = Math.round((successCount / total) * 100);
  const errorPct = 100 - successPct;
  return (
    <Box direction="row" height={10} overflow="hidden" rounding="lg" width="100%">
      {successCount > 0 && <Box color="success" width={`${successPct}%`} />}
      {errorCount > 0 && <Box color="error" width={`${errorPct}%`} />}
    </Box>
  );
};

export const AdminScriptRunModal: React.FC<AdminScriptRunModalProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  scriptName,
  scriptDescription,
  visible,
  onDismiss,
  dryRunOnly = false,
  historyTaskId,
}) => {
  const {apiBase: resolvedApiBase} = resolveAdminBases({apiBase, baseUrl, routeBase});
  const isHistory = Boolean(historyTaskId);
  const [taskId, setTaskId] = useState<string | null>(historyTaskId ?? null);
  const [phase, setPhase] = useState<Phase>(isHistory ? "running" : "confirm");
  const [isDryRun, setIsDryRun] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [outputFilter, setOutputFilter] = useState<OutputFilter>("all");
  const [search, setSearch] = useState("");
  const startingRef = useRef(false);

  const {useRunScriptMutation, useGetScriptTaskQuery, useCancelScriptTaskMutation} =
    useAdminScripts(resolvedApiBase);

  const [runScript] = useRunScriptMutation();
  const [cancelTask, {isLoading: isCancelling}] = useCancelScriptTaskMutation();

  const shouldPoll = phase === "running" && taskId !== null;
  const {data: taskData} = useGetScriptTaskQuery(taskId ?? "", {
    pollingInterval: shouldPoll ? POLL_INTERVAL_MS : 0,
    skip: !taskId,
  });

  const task: BackgroundTask | undefined = taskData?.task;
  const effectiveIsDryRun = isHistory ? Boolean(task?.isDryRun) : isDryRun;

  // Derive the rendered phase straight from the task's terminal status so a completed
  // run always shows the done view — even if the status-change effect below is delayed
  // or missed (which otherwise leaves the spinner up at "Done · 100%").
  const taskIsTerminal = Boolean(task && isTerminalStatus(task.status));
  const displayPhase: Phase =
    phase === "confirm" && !isHistory
      ? "confirm"
      : taskIsTerminal || startError
        ? "done"
        : "running";

  // After a completed dry run, offer a live run straight from the done view.
  const canRunLiveFromDone =
    !isHistory && !dryRunOnly && effectiveIsDryRun && task?.status === "completed";

  // Reset to a clean slate whenever the modal opens (or the target script changes),
  // and bind to a history task when opened read-only. Keyed on `visible`/`scriptName`
  // (not just `!visible`) so a previous run's results never linger on reopen.
  useEffect(() => {
    setStartError(null);
    setOutputFilter("all");
    setSearch("");
    startingRef.current = false;
    if (historyTaskId) {
      setTaskId(historyTaskId);
      setPhase("running");
    } else {
      setTaskId(null);
      setIsDryRun(false);
      setPhase("confirm");
    }
  }, [visible, historyTaskId, scriptName]);

  // Transition to done when the task reaches a terminal status (stops polling). Skipped
  // during the confirm step so a stale cached task can't pull us out of it.
  useEffect(() => {
    if (phase === "confirm" && !isHistory) {
      return;
    }
    if (task && isTerminalStatus(task.status)) {
      setPhase("done");
    } else if (isHistory && task && !isTerminalStatus(task.status)) {
      setPhase("running");
    }
  }, [task?.status, isHistory, phase]);

  const startRun = useCallback(
    async (wetRun: boolean) => {
      if (!scriptName || startingRef.current) {
        return;
      }
      startingRef.current = true;
      setIsDryRun(!wetRun);
      setTaskId(null);
      setStartError(null);
      setOutputFilter("all");
      setSearch("");
      setPhase("running");
      try {
        const result = await runScript({name: scriptName, wetRun}).unwrap();
        setTaskId(result.taskId);
      } catch (err: unknown) {
        const errData = (err as {data?: {title?: string; detail?: string}})?.data;
        const message = errData?.detail ?? errData?.title ?? "Failed to start script";
        setStartError(message);
        setPhase("done");
      } finally {
        startingRef.current = false;
      }
    },
    [scriptName, runScript]
  );

  const handleCancelTask = useCallback(async () => {
    if (!taskId) {
      return;
    }
    try {
      await cancelTask(taskId).unwrap();
    } catch {
      // Cancellation failed, task may already be done
    }
  }, [taskId, cancelTask]);

  const resultLines = task?.result ?? [];
  const summary = useMemo(() => summarizeOutput(task), [task]);

  const filteredLines = useMemo(() => {
    const query = search.trim().toLowerCase();
    return resultLines.filter((line) => {
      if (outputFilter === "errors" && !isErrorLine(line)) {
        return false;
      }
      if (query && !line.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [resultLines, outputFilter, search]);

  const handleExport = useCallback(
    (kind: "csv" | "json") => {
      if (resultLines.length === 0) {
        return;
      }
      const {content, mimeType} = buildExport(resultLines, kind);
      downloadFile(`${scriptName ?? "script"}_results.${kind}`, content, mimeType);
    },
    [resultLines, scriptName]
  );

  const renderHeader = (): React.ReactElement => (
    <Box direction="row" gap={3}>
      <Box
        alignItems="center"
        color="secondaryDark"
        height={44}
        justifyContent="center"
        rounding="md"
        width={44}
      >
        <Icon color="inverted" iconName="terminal" size="md" />
      </Box>
      <Box flex="grow" gap={1}>
        <Box alignItems="center" direction="row" gap={2} wrap>
          <Heading size="md">{scriptName}</Heading>
          {(phase !== "confirm" || isHistory) && (
            <Badge
              status={effectiveIsDryRun ? "info" : "warning"}
              value={effectiveIsDryRun ? "DRY" : "LIVE"}
            />
          )}
        </Box>
        {scriptDescription && (
          <Text color="secondaryDark" size="sm">
            {scriptDescription}
          </Text>
        )}
      </Box>
    </Box>
  );

  const renderConfirm = (): React.ReactElement => (
    <Box gap={4}>
      {renderHeader()}
      <Box color="secondaryLight" direction="row" gap={3} padding={3} rounding="md">
        <Icon color="secondaryDark" iconName="flask" size="sm" />
        <Box flex="grow" gap={1}>
          <Text bold size="sm">
            Start with a dry run
          </Text>
          <Text color="secondaryDark" size="sm">
            {dryRunOnly
              ? "Dry runs simulate the script without persisting any changes."
              : "A dry run simulates the script without writing. Run the live script once you've confirmed a dry run looks right."}
          </Text>
        </Box>
      </Box>
      <Box direction="row" gap={2} justifyContent="center" wrap>
        <Button
          iconName="flask"
          onClick={() => startRun(false)}
          testID="admin-script-dry-run-button"
          text="Dry Run"
          variant={dryRunOnly ? "primary" : "secondary"}
        />
        {!dryRunOnly && (
          <Button
            confirmationText={`Run "${scriptName}" for real? This will persist changes.`}
            iconName="bolt"
            onClick={() => startRun(true)}
            testID="admin-script-wet-run-button"
            text="Run live"
            variant="primary"
            withConfirmation
          />
        )}
        <Button
          onClick={onDismiss}
          testID="admin-script-confirm-cancel-button"
          text="Cancel"
          variant="muted"
        />
      </Box>
    </Box>
  );

  const renderRunning = (): React.ReactElement => (
    <Box gap={4}>
      {renderHeader()}
      <Box alignItems="center" gap={3} paddingY={4}>
        <Spinner size="md" />
        {task?.progress?.message && <Text align="center">{task.progress.message}</Text>}
        {task?.progress?.stage && (
          <Text align="center" color="secondaryDark" size="sm">
            {task.progress.stage}
          </Text>
        )}
        {task?.progress?.percentage !== undefined && task.progress.percentage > 0 && (
          <Text align="center" color="secondaryDark" size="sm">
            {task.progress.percentage}%
          </Text>
        )}
      </Box>
      {!isHistory && (
        <Box alignItems="center">
          <Button
            disabled={isCancelling || !taskId}
            iconName="stop"
            loading={isCancelling}
            onClick={handleCancelTask}
            testID="admin-script-cancel-button"
            text="Cancel run"
            variant="destructive"
          />
        </Box>
      )}
    </Box>
  );

  const renderSummary = (): React.ReactElement => (
    <Box border="default" gap={3} padding={3} rounding="md">
      <Box alignItems="center" direction="row" gap={2}>
        <Badge
          status={effectiveIsDryRun ? "info" : "warning"}
          value={effectiveIsDryRun ? "DRY" : "LIVE"}
        />
        <Text bold>{effectiveIsDryRun ? "Dry run" : "Live run"}</Text>
        <Box flex="grow" />
        {isHistory && task?.created && (
          <Text color="secondaryDark" size="sm">
            {relativeTime(task.created)}
          </Text>
        )}
      </Box>
      <Box direction="row" gap={5} wrap>
        <CountStat
          iconColor="success"
          iconName="circle-check"
          label="Success"
          value={summary.successCount}
        />
        <CountStat
          iconColor="error"
          iconName="circle-xmark"
          label="Errors"
          value={summary.errorCount}
        />
        <CountStat
          iconColor="secondaryDark"
          iconName="layer-group"
          label="Total lines"
          value={summary.total}
        />
      </Box>
      <SegmentBar
        errorCount={summary.errorCount}
        successCount={summary.successCount}
        total={summary.total}
      />
    </Box>
  );

  const renderGateBanner = (): React.ReactElement | null => {
    const status = task?.status ?? (startError ? "failed" : undefined);
    if (startError) {
      return <Banner status="alert" text={startError} />;
    }
    if (status === "completed") {
      return (
        <Banner
          status={summary.errorCount > 0 ? "warning" : "info"}
          text={
            summary.errorCount > 0
              ? `Completed with ${summary.errorCount} error${summary.errorCount === 1 ? "" : "s"}.`
              : effectiveIsDryRun
                ? "Dry run completed cleanly."
                : "Live run completed successfully."
          }
        />
      );
    }
    if (status === "failed") {
      return <Banner status="alert" text={task?.error ?? "Script failed."} />;
    }
    if (status === "cancelled") {
      return <Banner status="warning" text="Run was cancelled." />;
    }
    return null;
  };

  const renderResults = (): React.ReactElement | null => {
    if (resultLines.length === 0) {
      return null;
    }
    return (
      <Box gap={2}>
        <Box alignItems="center" direction="row" gap={2} wrap>
          <Button
            onClick={() => setOutputFilter("all")}
            text={`All (${summary.total})`}
            variant={outputFilter === "all" ? "secondary" : "muted"}
          />
          <Button
            onClick={() => setOutputFilter("errors")}
            text={`Errors (${summary.errorCount})`}
            variant={outputFilter === "errors" ? "secondary" : "muted"}
          />
          <Box flex="grow" minWidth={160}>
            <TextField
              iconName="magnifying-glass"
              onChange={setSearch}
              placeholder="Search output"
              type="search"
              value={search}
            />
          </Box>
        </Box>
        <Box border="default" gap={1} maxHeight={280} overflow="scrollY" padding={2} rounding="md">
          {filteredLines.length === 0 ? (
            <Text color="secondaryDark" size="sm">
              No output lines match this filter.
            </Text>
          ) : (
            filteredLines.map((line, index) => (
              <Text
                color={isErrorLine(line) ? "error" : "secondaryDark"}
                key={`${index}-${line.slice(0, 24)}`}
                size="sm"
              >
                {line}
              </Text>
            ))
          )}
        </Box>
      </Box>
    );
  };

  const renderDone = (): React.ReactElement => {
    const meta = statusMeta(task?.status ?? "failed");
    const duration = formatDuration(task?.startedAt, task?.completedAt);
    const iconColor =
      meta.badgeStatus === "success" ||
      meta.badgeStatus === "error" ||
      meta.badgeStatus === "warning"
        ? meta.badgeStatus
        : "secondaryDark";
    return (
      <Box gap={3}>
        {renderHeader()}
        {renderSummary()}
        {renderGateBanner()}
        {renderResults()}
        <Box alignItems="center" direction="row" gap={2} wrap>
          <Icon color={iconColor} iconName={meta.iconName} size="sm" />
          <Text bold size="sm">
            {meta.label}
          </Text>
          {duration ? (
            <Text color="secondaryDark" size="sm">
              · {duration}
            </Text>
          ) : null}
          <Box flex="grow" />
          <Button
            disabled={resultLines.length === 0}
            iconName="file-csv"
            onClick={() => handleExport("csv")}
            text="Export CSV"
            variant="outline"
          />
          <Button
            disabled={resultLines.length === 0}
            iconName="file-code"
            onClick={() => handleExport("json")}
            text="Export JSON"
            variant="outline"
          />
          {canRunLiveFromDone ? (
            <>
              <Button
                iconName="rotate-right"
                onClick={() => startRun(false)}
                text="Re-run dry"
                variant="muted"
              />
              <Button
                confirmationText={`Run "${scriptName}" for real? This will persist changes.`}
                disabled={summary.errorCount > 0}
                iconName="bolt"
                onClick={() => startRun(true)}
                testID="admin-script-done-wet-run-button"
                text="Run live"
                tooltipText={
                  summary.errorCount > 0 ? "Resolve errors before running live" : undefined
                }
                variant="primary"
                withConfirmation
              />
            </>
          ) : null}
        </Box>
      </Box>
    );
  };

  const isComplete = displayPhase === "done";

  return (
    <Modal
      onDismiss={onDismiss}
      persistOnBackgroundClick={!isComplete}
      primaryButtonOnClick={isComplete ? onDismiss : undefined}
      primaryButtonText={isComplete ? "Close" : undefined}
      size="lg"
      visible={visible}
    >
      <Box gap={2} minHeight={220} padding={2}>
        {displayPhase === "confirm" && renderConfirm()}
        {displayPhase === "running" && renderRunning()}
        {displayPhase === "done" && renderDone()}
      </Box>
    </Modal>
  );
};
