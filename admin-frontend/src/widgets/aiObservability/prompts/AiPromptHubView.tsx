import {Badge, Box, Heading, SegmentedControl, Spinner, Text} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useMemo, useState} from "react";
import {
  ObservabilityTable,
  type ObservabilityTableColumn,
  type ObservabilityTableRow,
} from "../shell/ObservabilityTable";
import type {PromptActionPermissions} from "../shell/observabilityPermissions";
import {AiPromptEditorView} from "./AiPromptEditorView";
import {
  formatProduction,
  latestVersionFromDetail,
  type PlaygroundRunResult,
  type PromptDetail,
  productionVersionFromDetail,
} from "./promptTypes";

export interface AiPromptHubViewProps {
  detail: PromptDetail;
  isApiKeyLoading?: boolean;
  isRelationshipsLoading?: boolean;
  isRunningPlayground: boolean;
  isSaving: boolean;
  isSettingProduction: boolean;
  onOpenExperiment?: (experimentId: string) => void;
  onOpenTrace?: (traceId: string) => void;
  onRunPlayground: (variables: Record<string, string>) => Promise<void>;
  onSaveVersion: (body: {
    config?: Record<string, unknown>;
    system?: string;
    template: string;
    type: "chat" | "text";
    variables?: Array<{key: string; required: boolean}>;
  }) => Promise<void>;
  onSelectVersion: (version: number) => void;
  onSetProduction: (version: number) => Promise<void>;
  permissions: PromptActionPermissions;
  playgroundBlockedMessage?: string;
  playgroundError?: string;
  playgroundResult?: PlaygroundRunResult;
  productionError?: string;
  relationshipsError?: string;
  saveError?: string;
  selectedVersion: number;
}

const HUB_TABS = ["Overview", "Versions", "Traces", "Experiments"];

const TRACE_COLUMNS: ObservabilityTableColumn[] = [
  {grow: 2, minWidth: 180, title: "Trace"},
  {minWidth: 80, title: "Version"},
  {minWidth: 90, title: "Status"},
  {grow: 1.2, minWidth: 140, title: "Started"},
];

const EXPERIMENT_COLUMNS: ObservabilityTableColumn[] = [
  {grow: 2, minWidth: 180, title: "Experiment"},
  {minWidth: 100, title: "Status"},
  {grow: 1.2, minWidth: 140, title: "Created"},
  {minWidth: 120, title: "Versions"},
];

const formatTimestamp = (value: string): string => {
  const timestamp = DateTime.fromISO(value);
  if (!timestamp.isValid) {
    return value;
  }
  return timestamp.toLocal().toLocaleString(DateTime.DATETIME_MED);
};

const PromptOverviewPanel: React.FC<{detail: PromptDetail}> = ({detail}) => {
  const latest = latestVersionFromDetail(detail);
  const production = productionVersionFromDetail(detail);
  return (
    <Box gap={3} testID="ai-prompt-overview">
      {detail.description ? (
        <Text testID="ai-prompt-description">{detail.description}</Text>
      ) : (
        <Text color="secondaryDark" testID="ai-prompt-description-empty">
          No description yet.
        </Text>
      )}
      <Box direction="row" gap={2} wrap>
        <Badge status="info" testID="ai-prompt-folder" value={`Folder: ${detail.folder}`} />
        <Badge status="neutral" testID="ai-prompt-latest" value={`Latest: v${latest}`} />
        <Badge
          status={production === undefined ? "warning" : "success"}
          testID="ai-prompt-production-badge"
          value={`Production: ${formatProduction(production ?? "—")}`}
        />
      </Box>
      <Box gap={1}>
        <Heading size="sm">Tags</Heading>
        {detail.tags.length > 0 ? (
          <Box direction="row" gap={1} testID="ai-prompt-tags" wrap>
            {detail.tags.map((tag) => (
              <Badge key={tag} status="neutral" value={tag} />
            ))}
          </Box>
        ) : (
          <Text color="secondaryDark">No tags.</Text>
        )}
      </Box>
    </Box>
  );
};

const RelationshipPanel: React.FC<{
  columns: ObservabilityTableColumn[];
  emptyLabel: string;
  error?: string;
  isLoading?: boolean;
  onOpenRow?: (id: string) => void;
  rows: ObservabilityTableRow[];
  testID: string;
  total: number;
}> = ({columns, emptyLabel, error, isLoading, onOpenRow, rows, testID, total}) => {
  if (isLoading) {
    return (
      <Box alignItems="center" padding={4} testID={`${testID}-loading`}>
        <Spinner />
      </Box>
    );
  }
  if (error) {
    return (
      <Box gap={2} testID={`${testID}-error`}>
        <Text color="error">{error}</Text>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box padding={2} testID={`${testID}-empty`}>
        <Text color="secondaryDark">{emptyLabel}</Text>
      </Box>
    );
  }
  return (
    <Box gap={2}>
      <Text color="secondaryDark" size="sm" testID={`${testID}-total`}>
        {`Showing ${rows.length} of ${total} recent items.`}
      </Text>
      <ObservabilityTable
        columns={columns}
        rows={rows.map((row) => ({
          ...row,
          onClick: onOpenRow ? () => onOpenRow(row.key) : undefined,
        }))}
        testID={testID}
      />
    </Box>
  );
};

export const AiPromptHubView: React.FC<AiPromptHubViewProps> = ({
  detail,
  isApiKeyLoading,
  isRelationshipsLoading,
  isRunningPlayground,
  isSaving,
  isSettingProduction,
  onOpenExperiment,
  onOpenTrace,
  onRunPlayground,
  onSaveVersion,
  onSelectVersion,
  onSetProduction,
  permissions,
  playgroundBlockedMessage,
  playgroundError,
  playgroundResult,
  productionError,
  relationshipsError,
  saveError,
  selectedVersion,
}) => {
  const [tabIndex, setTabIndex] = useState(0);

  const traceRows: ObservabilityTableRow[] = useMemo(() => {
    return detail.relationships.traces.items.map((trace) => ({
      cells: [
        trace.name,
        `v${trace.promptVersion}`,
        trace.status === "error" ? "Error" : "OK",
        formatTimestamp(trace.startedAt),
      ],
      key: trace.id,
    }));
  }, [detail.relationships.traces.items]);

  const experimentRows: ObservabilityTableRow[] = useMemo(() => {
    return detail.relationships.experiments.items.map((experiment) => ({
      cells: [
        experiment.name,
        experiment.status,
        formatTimestamp(experiment.created),
        experiment.versions.map((version) => `v${version}`).join(", "),
      ],
      key: experiment.id,
    }));
  }, [detail.relationships.experiments.items]);

  return (
    <Box flex="grow" gap={4} testID="ai-prompt-hub">
      <Heading size="md">{detail.name}</Heading>
      <SegmentedControl
        items={HUB_TABS}
        onChange={setTabIndex}
        selectedIndex={tabIndex}
        testID="ai-prompt-hub-tabs"
      />
      {tabIndex === 0 ? <PromptOverviewPanel detail={detail} /> : undefined}
      {tabIndex === 1 ? (
        <AiPromptEditorView
          canPlayground={permissions.canPlayground}
          canPromote={permissions.canPromote}
          canUpdate={permissions.canUpdate}
          detail={detail}
          isApiKeyLoading={isApiKeyLoading}
          isRunningPlayground={isRunningPlayground}
          isSaving={isSaving}
          isSettingProduction={isSettingProduction}
          onRunPlayground={onRunPlayground}
          onSaveVersion={onSaveVersion}
          onSelectVersion={onSelectVersion}
          onSetProduction={onSetProduction}
          playgroundBlockedMessage={playgroundBlockedMessage}
          playgroundError={playgroundError}
          playgroundResult={playgroundResult}
          productionError={productionError}
          saveError={saveError}
          selectedVersion={selectedVersion}
        />
      ) : undefined}
      {tabIndex === 2 ? (
        <RelationshipPanel
          columns={TRACE_COLUMNS}
          emptyLabel="No traces recorded for this prompt yet."
          error={relationshipsError}
          isLoading={isRelationshipsLoading}
          onOpenRow={onOpenTrace}
          rows={traceRows}
          testID="ai-prompt-traces"
          total={detail.relationships.traces.total}
        />
      ) : undefined}
      {tabIndex === 3 ? (
        <RelationshipPanel
          columns={EXPERIMENT_COLUMNS}
          emptyLabel="No experiments reference this prompt yet."
          error={relationshipsError}
          isLoading={isRelationshipsLoading}
          onOpenRow={onOpenExperiment}
          rows={experimentRows}
          testID="ai-prompt-experiments"
          total={detail.relationships.experiments.total}
        />
      ) : undefined}
    </Box>
  );
};
