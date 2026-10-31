import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  Icon,
  Page,
  SegmentedControl,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AdminScriptRunModal} from "./AdminScriptRunModal";
import {
  formatDuration,
  latestRunByScript,
  relativeTime,
  shortId,
  statusMeta,
  summarizeOutput,
} from "./scriptRunUtils";
import {type AdminScriptConfig, resolveAdminBases, type ScriptRun} from "./types";
import {useAdminConfig} from "./useAdminConfig";
import {useAdminScripts} from "./useAdminScripts";

interface AdminScriptListProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  /** When false, the Run button is disabled. Defaults to true. */
  isAdmin?: boolean;
}

const HISTORY_PAGE_SIZE = 25;

type Tab = "scripts" | "history";

interface SelectedRun {
  description?: string;
  scriptName: string;
  taskId: string;
}

export const AdminScriptList: React.FC<AdminScriptListProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  isAdmin = true,
}) => {
  const {apiBase: resolvedApiBase, routeBase: resolvedRouteBase} = resolveAdminBases({
    apiBase,
    baseUrl,
    routeBase,
  });
  const {config, isLoading, error} = useAdminConfig(resolvedApiBase);
  const {useListScriptRunsQuery} = useAdminScripts(resolvedApiBase);
  const canRunScripts = isAdmin && (config?.platformTools?.runScripts ?? true);
  const canViewScripts = config?.platformTools?.viewScripts ?? true;

  const [tab, setTab] = useState<Tab>("scripts");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyScriptName, setHistoryScriptName] = useState<string | null>(null);
  const [historyRuns, setHistoryRuns] = useState<ScriptRun[]>([]);
  const [historyRunsKey, setHistoryRunsKey] = useState<string | null>(null);
  const historyKeyRef = useRef<string | null>(null);
  const [selectedScript, setSelectedScript] = useState<AdminScriptConfig | null>(null);
  const [selectedRun, setSelectedRun] = useState<SelectedRun | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  // Unfiltered most-recent runs power the per-script "Last run" badges on the Scripts tab.
  const {data: latestRunsData} = useListScriptRunsQuery(
    {limit: HISTORY_PAGE_SIZE, page: 1},
    {skip: !canViewScripts}
  );
  const latestRuns: ScriptRun[] = useMemo(() => latestRunsData?.data ?? [], [latestRunsData]);
  const lastRuns = useMemo(() => latestRunByScript(latestRuns), [latestRuns]);

  // Paginated history, optionally scoped to a single script via the per-script History link.
  const {data: historyData} = useListScriptRunsQuery(
    {
      limit: HISTORY_PAGE_SIZE,
      name: historyScriptName ?? undefined,
      page: historyPage,
    },
    {skip: !canViewScripts}
  );

  // Accumulate each loaded history page (de-duplicated by id) so "Load more" advances through
  // pages instead of re-requesting a server-capped first page. Keying on the active filter lets
  // a filter change replace the list (rather than blanking state and risking an empty render when
  // a refetch returns the same page).
  useEffect(() => {
    if (!historyData?.data) {
      return;
    }
    const filterKey = historyScriptName ?? "__all__";
    setHistoryRuns((prev) => {
      const base = historyKeyRef.current === filterKey ? prev : [];
      const byId = new Map(base.map((run) => [run._id, run]));
      for (const run of historyData.data ?? []) {
        byId.set(run._id, run);
      }
      return Array.from(byId.values());
    });
    historyKeyRef.current = filterKey;
    setHistoryRunsKey(filterKey);
  }, [historyData, historyScriptName]);

  // The accumulated list belongs to whichever filter last loaded. While a newly-selected filter
  // is still fetching, the list does not yet match the active scope; render a spinner instead of
  // stale runs from the previous filter.
  const activeFilterKey = historyScriptName ?? "__all__";
  const historyMatchesFilter = historyRunsKey === activeFilterKey;

  const handleRunScript = useCallback((script: AdminScriptConfig) => {
    setSelectedRun(null);
    setSelectedScript(script);
    setModalVisible(true);
  }, []);

  const handleOpenRun = useCallback((run: ScriptRun, description?: string) => {
    setSelectedScript(null);
    setSelectedRun({description, scriptName: run.taskType, taskId: run._id});
    setModalVisible(true);
  }, []);

  const handleViewHistory = useCallback((scriptName?: string) => {
    setHistoryScriptName(scriptName ?? null);
    setHistoryPage(1);
    setTab("history");
  }, []);

  const handleLoadMore = useCallback(() => {
    setHistoryPage((page) => page + 1);
  }, []);

  const handleClearHistoryFilter = useCallback(() => {
    setHistoryScriptName(null);
    setHistoryPage(1);
  }, []);

  const handleDismiss = useCallback(() => {
    setModalVisible(false);
    setSelectedScript(null);
    setSelectedRun(null);
  }, []);

  const handleTabChange = useCallback((index: number) => {
    if (index === 1) {
      // Selecting the global history tab clears any per-script filter.
      setHistoryScriptName(null);
      setHistoryPage(1);
      setTab("history");
      return;
    }
    setTab("scripts");
  }, []);

  if (isLoading) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title="Scripts">
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  if (error || !config) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title="Scripts">
        <Box padding={4}>
          <Text color="error">Failed to load admin configuration.</Text>
        </Box>
      </Page>
    );
  }

  const scripts = config.scripts ?? [];

  if (scripts.length === 0) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title="Scripts">
        <Box alignItems="center" padding={6}>
          <Text color="secondaryDark">No scripts registered.</Text>
        </Box>
      </Page>
    );
  }

  const descriptionFor = (name: string): string | undefined =>
    scripts.find((s) => s.name === name)?.description;

  const renderLastRun = (script: AdminScriptConfig): React.ReactElement | null => {
    const run = lastRuns[script.name];
    if (!run) {
      return null;
    }
    const meta = statusMeta(run.status);
    const iconColor =
      meta.badgeStatus === "success" ||
      meta.badgeStatus === "error" ||
      meta.badgeStatus === "warning"
        ? meta.badgeStatus
        : "secondaryDark";
    return (
      <Box alignItems="center" direction="row" gap={2} marginTop={1} wrap>
        <Icon color={iconColor} iconName={meta.iconName} size="sm" />
        <Text color="secondaryDark" size="sm">
          Last run {relativeTime(run.created)} — {run.isDryRun ? "dry run" : "live run"}{" "}
          {meta.label.toLowerCase()}
        </Text>
        {canViewScripts ? (
          <Box
            accessibilityHint={`Opens run history for ${script.name}`}
            accessibilityLabel={`View run history for ${script.name}`}
            onClick={() => handleViewHistory(script.name)}
            testID={`admin-script-history-${script.name}`}
          >
            <Text color="link" size="sm">
              History
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  };

  const renderScripts = (): React.ReactElement => (
    <Box gap={3} padding={4}>
      {scripts.map((script: AdminScriptConfig) => (
        <Card key={script.name} padding={4} testID={`admin-script-card-${script.name}`}>
          <Box alignItems="center" direction="row" gap={4} justifyContent="between">
            <Box flex="grow" gap={1}>
              <Heading size="sm">{script.name}</Heading>
              <Text color="secondaryDark" size="sm">
                {script.description}
              </Text>
              {renderLastRun(script)}
            </Box>
            <Button
              disabled={!canRunScripts}
              iconName="play"
              onClick={() => handleRunScript(script)}
              testID={`admin-script-run-${script.name}`}
              text="Run"
              tooltipText={!canRunScripts ? "You do not have permission to run scripts" : undefined}
              variant="primary"
            />
          </Box>
        </Card>
      ))}
      <Box alignItems="center" direction="row" gap={2} justifyContent="center" paddingY={2}>
        <Icon color="secondaryDark" iconName="circle-info" size="sm" />
        <Text color="secondaryDark" size="sm">
          Each Run opens the runner. Start with a dry run to preview changes before running live.
        </Text>
      </Box>
    </Box>
  );

  const renderRunRow = (run: ScriptRun): React.ReactElement => {
    const meta = statusMeta(run.status);
    const summary = summarizeOutput(run);
    const duration = formatDuration(run.startedAt, run.completedAt);
    return (
      <Box
        accessibilityHint="Opens this run's output"
        accessibilityLabel={`Open run ${run.taskType}`}
        alignItems="center"
        border="default"
        direction="row"
        gap={3}
        key={run._id}
        onClick={() => handleOpenRun(run, descriptionFor(run.taskType))}
        padding={3}
        rounding="md"
        wrap
      >
        <Box flex="grow" gap={1} minWidth={180}>
          <Box alignItems="baseline" direction="row" gap={2} wrap>
            <Text bold>{run.taskType}</Text>
            <Text color="secondaryDark" size="sm">
              #{shortId(run._id)}
            </Text>
          </Box>
          <Text color="secondaryDark" size="sm">
            {summary.total} line{summary.total === 1 ? "" : "s"}
            {summary.errorCount > 0
              ? ` · ${summary.errorCount} error${summary.errorCount === 1 ? "" : "s"}`
              : ""}
            {duration ? ` · ${duration}` : ""}
          </Text>
        </Box>
        <Box gap={1} minWidth={110}>
          <Text size="sm">{relativeTime(run.created)}</Text>
          {run.createdByName ? (
            <Text color="secondaryDark" size="sm">
              {run.createdByName}
            </Text>
          ) : null}
        </Box>
        <Badge status={run.isDryRun ? "info" : "warning"} value={run.isDryRun ? "DRY" : "LIVE"} />
        <Badge
          iconName={meta.iconName}
          secondary
          status={meta.badgeStatus === "neutral" ? "info" : meta.badgeStatus}
          value={meta.label}
        />
        <Button
          iconName="arrow-right"
          onClick={() => handleOpenRun(run, descriptionFor(run.taskType))}
          text="Open"
          variant="outline"
        />
      </Box>
    );
  };

  const renderHistory = (): React.ReactElement => (
    <Box gap={3} padding={4}>
      <Box gap={1}>
        <Heading size="sm">Run history</Heading>
        <Text color="secondaryDark" size="sm">
          {historyScriptName
            ? `Showing runs for ${historyScriptName}. Open a run to review its output.`
            : "Every dry and live run is logged. Open a run to review its output."}
        </Text>
        {historyScriptName ? (
          <Box
            accessibilityHint="Shows runs for every script"
            accessibilityLabel="Show all scripts"
            onClick={handleClearHistoryFilter}
            testID="admin-script-history-clear-filter"
          >
            <Text color="link" size="sm">
              Show all scripts
            </Text>
          </Box>
        ) : null}
      </Box>
      {!historyMatchesFilter ? (
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      ) : historyRuns.length === 0 ? (
        <Box alignItems="center" padding={6}>
          <Text color="secondaryDark">
            {historyScriptName ? "No runs logged for this script yet." : "No runs logged yet."}
          </Text>
        </Box>
      ) : (
        <Box gap={2}>
          {historyRuns.map((run) => renderRunRow(run))}
          {historyData?.more && (
            <Box alignItems="center" paddingY={2}>
              <Button onClick={handleLoadMore} text="Load more" variant="muted" />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  return (
    <Page color="transparent" maxWidth="100%" padding={0} scroll title="Scripts">
      {canViewScripts ? (
        <Box paddingX={4} paddingY={4}>
          <SegmentedControl
            items={[
              "Scripts",
              (latestRunsData?.total ?? latestRuns.length) > 0
                ? `Run history (${latestRunsData?.total ?? latestRuns.length})`
                : "Run history",
            ]}
            onChange={handleTabChange}
            selectedIndex={tab === "history" ? 1 : 0}
          />
        </Box>
      ) : null}

      {tab === "scripts" ? renderScripts() : renderHistory()}

      <AdminScriptRunModal
        apiBase={resolvedApiBase}
        historyTaskId={selectedRun?.taskId}
        onDismiss={handleDismiss}
        routeBase={resolvedRouteBase}
        scriptDescription={selectedRun?.description ?? selectedScript?.description}
        scriptName={selectedRun?.scriptName ?? selectedScript?.name ?? null}
        visible={modalVisible}
      />
    </Page>
  );
};
