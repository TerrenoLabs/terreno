import {
  Badge,
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  type LayoutChangeEvent,
  Modal,
  SelectField,
  Text,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {
  type ExperimentRecord,
  experimentItemColumnWidths,
  gatesForVersion,
} from "./experimentTypes";

export interface AiExperimentResultsViewProps {
  experiment: ExperimentRecord;
  isPromoting: boolean;
  onPromote: (version: number) => void;
  promoteBlockedMessage?: string;
  promoteConfirmOpen: boolean;
  promoteError?: string;
  promoteVersion: number;
  selectedVersion: number;
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

export const AiExperimentResultsView: React.FC<AiExperimentResultsViewProps> = ({
  experiment,
  isPromoting,
  onPromote,
  promoteBlockedMessage,
  promoteConfirmOpen,
  promoteError,
  promoteVersion,
  selectedVersion,
  onDismissPromoteConfirm,
  onOpenPromoteConfirm,
  onSelectVersion,
}) => {
  const versionGates = gatesForVersion(experiment, selectedVersion);
  const failing = versionGates.filter((gate) => {
    return !gate.passed;
  }).length;
  const blockedGate = versionGates.find((gate) => !gate.passed);

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
        const passed = Object.values(scores).every((entry) => !entry.error);
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
      {failing > 0 ? (
        <Badge
          status="error"
          testID="ai-experiment-gates-failing"
          value={`${failing} gates failing`}
        />
      ) : undefined}
      <Box direction="row" gap={2} wrap>
        {versionGates.map((gate) => {
          return (
            <Box
              color={gate.passed ? "successLight" : "errorLight"}
              key={`${gate.version}-${gate.dimension}`}
              padding={2}
              testID={`ai-experiment-gate-${gate.dimension}`}
            >
              <Text bold>
                v{gate.version} {gate.evaluatorName}.{gate.dimension}
              </Text>
              <Text>
                {gate.actual !== undefined ? gate.actual.toFixed(2) : "—"} {gate.op} {gate.value} —{" "}
                {gate.passed ? "pass" : "fail"}
              </Text>
            </Box>
          );
        })}
      </Box>
      {blockedGate && promoteBlockedMessage ? (
        <Text color="error" testID="ai-experiment-promote-blocked">
          Promote blocked: {promoteBlockedMessage}
        </Text>
      ) : undefined}
      {outliers.length > 0 ? (
        <Box gap={1} testID="ai-experiment-outliers">
          <Text bold>Outliers</Text>
          {outliers.map((itemId) => {
            return <Badge key={itemId} status="warning" value={itemId.slice(-8)} />;
          })}
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
      <Box direction="row" gap={2} wrap>
        <SelectField
          onChange={(value) => {
            const version = Number(value);
            onSelectVersion(version);
          }}
          options={experiment.versions.map((version) => {
            return {label: `v${version}`, value: String(version)};
          })}
          title="Promote version"
          value={String(promoteVersion)}
        />
        <Button
          disabled={Boolean(blockedGate)}
          onClick={onOpenPromoteConfirm}
          testID="ai-experiment-promote"
          text="Promote to production"
        />
      </Box>
      {promoteError ? (
        <Text color="error" testID="ai-experiment-promote-error">
          {promoteError}
        </Text>
      ) : undefined}
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
          {blockedGate ? (
            <Text color="error">
              Gate {blockedGate.evaluatorName}.{blockedGate.dimension} is failing.
            </Text>
          ) : undefined}
        </Box>
      </Modal>
    </Box>
  );
};
