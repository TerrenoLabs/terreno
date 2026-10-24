import {
  Badge,
  Box,
  Button,
  Card,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  Heading,
  type LayoutChangeEvent,
  Modal,
  SelectField,
  Text,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {
  type ExperimentGateResult,
  type ExperimentRecord,
  experimentItemColumnWidths,
  formatGateActual,
  formatGateAggregate,
  formatGateName,
  formatGateThreshold,
  formatPromoteBlockedReason,
  formatVersionGateVerdict,
  summarizeGatesByVersion,
  type VersionGateSummary,
} from "./experimentTypes";

export interface AiExperimentResultsViewProps {
  experiment: ExperimentRecord;
  isPromoting: boolean;
  onPromote: (version: number) => void;
  promoteConfirmOpen: boolean;
  promoteError?: string;
  promoteVersion: number;
  onDismissPromoteConfirm: () => void;
  onOpenPromoteConfirm: () => void;
  onSelectVersion: (version: number) => void;
}

const OUTPUT_PREVIEW_CHARS = 200;
// Three lines of text, so longer outputs stay readable in the widened columns.
const ITEM_ROW_HEIGHT = 84;

const summarizeOutput = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > OUTPUT_PREVIEW_CHARS ? `${text.slice(0, OUTPUT_PREVIEW_CHARS)}…` : text;
};

const GateTile: React.FC<{gate: ExperimentGateResult}> = ({gate}) => {
  return (
    <Box
      color={gate.passed ? "successLight" : "errorLight"}
      gap={1}
      padding={2}
      rounding="md"
      testID={`ai-experiment-gate-v${gate.version}-${gate.dimension}`}
    >
      <Box alignItems="center" direction="row" gap={2} justifyContent="between">
        <Text bold>{formatGateName(gate)}</Text>
        <Text bold color={gate.passed ? "success" : "error"} size="sm">
          {gate.passed ? "✓ Pass" : "✗ Fail"}
        </Text>
      </Box>
      <Text size="sm">
        {formatGateAggregate(gate.aggregate)} {formatGateActual(gate.actual)} · needs{" "}
        {formatGateThreshold(gate)}
      </Text>
    </Box>
  );
};

const VersionGatesCard: React.FC<{isSelected: boolean; summary: VersionGateSummary}> = ({
  isSelected,
  summary,
}) => {
  const verdictStatus =
    summary.gates.length === 0 ? "neutral" : summary.passed ? "success" : "error";
  return (
    <Card
      border={isSelected ? "dark" : undefined}
      gap={2}
      minWidth={240}
      padding={3}
      testID={`ai-experiment-gates-v${summary.version}`}
    >
      <Box alignItems="center" direction="row" gap={2} justifyContent="between" wrap>
        <Heading size="sm">
          {`v${summary.version}${isSelected ? " (selected to promote)" : ""}`}
        </Heading>
        <Badge
          secondary
          status={verdictStatus}
          testID={`ai-experiment-gates-v${summary.version}-verdict`}
          value={formatVersionGateVerdict(summary)}
        />
      </Box>
      {summary.gates.length === 0 ? (
        <Text color="secondaryDark" size="sm">
          No gate scores yet.
        </Text>
      ) : (
        summary.gates.map((gate) => {
          return <GateTile gate={gate} key={`${gate.evaluatorName}-${gate.dimension}`} />;
        })
      )}
    </Card>
  );
};

export const AiExperimentResultsView: React.FC<AiExperimentResultsViewProps> = ({
  experiment,
  isPromoting,
  onPromote,
  promoteConfirmOpen,
  promoteError,
  promoteVersion,
  onDismissPromoteConfirm,
  onOpenPromoteConfirm,
  onSelectVersion,
}) => {
  const versionSummaries = useMemo(() => summarizeGatesByVersion(experiment), [experiment]);
  const promoteSummary = versionSummaries.find((summary) => summary.version === promoteVersion);
  const blockedReason = promoteSummary ? formatPromoteBlockedReason(promoteSummary) : undefined;
  const hasGates = versionSummaries.some((summary) => summary.gates.length > 0);

  const [tableWidth, setTableWidth] = useState(0);
  const handleTableLayout = useCallback((event: LayoutChangeEvent) => {
    setTableWidth(Math.floor(event.nativeEvent.layout.width));
  }, []);

  const itemColumns: DataTableColumn[] = useMemo(() => {
    const widths = experimentItemColumnWidths({
      containerWidth: tableWidth,
      versionCount: experiment.versions.length,
    });
    const versionCols: DataTableColumn[] = experiment.versions.flatMap((version) => {
      return [
        {columnType: "text" as const, title: `v${version} output`, width: widths.output},
        {columnType: "text" as const, title: `v${version} pass`, width: widths.pass},
      ];
    });
    return [{columnType: "text", title: "Item", width: widths.item}, ...versionCols];
  }, [experiment.versions, tableWidth]);

  const itemRows: DataTableCellData[][] = useMemo(() => {
    return experiment.items.map((item) => {
      const row: DataTableCellData[] = [{value: item.datasetItemId.slice(-6)}];
      for (const version of experiment.versions) {
        const result = item.versionResults[String(version)];
        row.push({value: summarizeOutput(result?.output)});
        const scores = result?.evaluatorScores ?? {};
        const passed = !result?.error && Object.values(scores).every((entry) => !entry.error);
        row.push({value: passed ? "pass" : "fail"});
      }
      return row;
    });
  }, [experiment.items, experiment.versions]);

  const outliers = experiment.results?.outlierItemIds ?? [];

  return (
    <Box gap={4} testID="ai-experiment-results">
      {experiment.status === "running" || experiment.status === "pending" ? (
        <Text testID="ai-experiment-results-running">
          Running… {experiment.results?.progress.completed ?? 0}/
          {experiment.results?.progress.total ?? 0}
        </Text>
      ) : undefined}
      {hasGates ? (
        <Box gap={2} testID="ai-experiment-gates">
          <Heading size="sm">Score gates by version</Heading>
          <Text color="secondaryDark" size="sm">
            A version can be promoted only when every one of its gates passes.
          </Text>
          <Box direction="row" gap={3} wrap>
            {versionSummaries.map((summary) => {
              return (
                <VersionGatesCard
                  isSelected={summary.version === promoteVersion}
                  key={summary.version}
                  summary={summary}
                />
              );
            })}
          </Box>
        </Box>
      ) : undefined}
      <Card gap={2} padding={3} testID="ai-experiment-promote-section">
        <Heading size="sm">Promote to production</Heading>
        <Box alignItems="end" direction="row" gap={2} wrap>
          <Box minWidth={160}>
            <SelectField
              onChange={(value) => {
                onSelectVersion(Number(value));
              }}
              options={experiment.versions.map((version) => {
                return {label: `v${version}`, value: String(version)};
              })}
              requireValue
              title="Version to promote"
              value={String(promoteVersion)}
            />
          </Box>
          <Button
            disabled={Boolean(blockedReason)}
            onClick={onOpenPromoteConfirm}
            testID="ai-experiment-promote"
            text="Promote to production"
          />
        </Box>
        {blockedReason ? (
          <Box gap={1} testID="ai-experiment-gates-failing">
            <Badge status="error" value={`Can't promote v${promoteVersion}`} />
            <Text color="error" size="sm">
              {blockedReason}
            </Text>
          </Box>
        ) : undefined}
        {!blockedReason && promoteSummary?.passed ? (
          <Box gap={1} testID="ai-experiment-gates-passing">
            <Badge status="success" value={`Ready to promote v${promoteVersion}`} />
            <Text color="secondaryDark" size="sm">
              {`v${promoteVersion} ${formatVersionGateVerdict(promoteSummary).toLowerCase()}.`}
            </Text>
          </Box>
        ) : undefined}
        {promoteError ? (
          <Text color="error" testID="ai-experiment-promote-error">
            {promoteError}
          </Text>
        ) : undefined}
      </Card>
      {outliers.length > 0 ? (
        <Box gap={1} testID="ai-experiment-outliers">
          <Text bold>Outliers</Text>
          <Box direction="row" gap={1} wrap>
            {outliers.map((itemId) => {
              return <Badge key={itemId} status="warning" value={itemId.slice(-8)} />;
            })}
          </Box>
        </Box>
      ) : undefined}
      <Box onLayout={handleTableLayout} testID="ai-experiment-items-table-container" width="100%">
        <DataTable
          columns={itemColumns}
          data={itemRows}
          rowHeight={ITEM_ROW_HEIGHT}
          testID="ai-experiment-items-table"
        />
      </Box>
      <Modal
        onDismiss={onDismissPromoteConfirm}
        primaryButtonDisabled={isPromoting}
        primaryButtonOnClick={() => {
          onPromote(promoteVersion);
        }}
        primaryButtonText="Promote"
        secondaryButtonOnClick={onDismissPromoteConfirm}
        secondaryButtonText="Cancel"
        title="Confirm promote"
        visible={promoteConfirmOpen}
      >
        <Box gap={2}>
          <Text>
            Promote v{promoteVersion} of {experiment.promptName} to production?
          </Text>
          {blockedReason ? <Text color="error">{blockedReason}</Text> : undefined}
        </Box>
      </Modal>
    </Box>
  );
};
