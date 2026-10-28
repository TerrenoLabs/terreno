import {
  Badge,
  Banner,
  Box,
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
import {ProgressMeter} from "../shell/AgreementMeter";
import {ObservabilityEmptyState} from "../shell/ObservabilityStates";
import {
  type ExperimentGateResult,
  type ExperimentRecord,
  experimentItemColumnWidths,
  formatGateActual,
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
  /** Kept for callers; the promote button lives in the page header. */
  onOpenPromoteConfirm?: () => void;
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

/** Versions whose gates all pass, in version order. */
const passingVersions = (summaries: VersionGateSummary[]): number[] => {
  return summaries.filter((summary) => summary.passed).map((summary) => summary.version);
};

/** The one-sentence verdict for the whole experiment, shown once as a banner. */
const experimentVerdict = (
  summaries: VersionGateSummary[]
): {status: "info" | "warning"; text: string} | undefined => {
  const gated = summaries.filter((summary) => summary.gates.length > 0);
  if (gated.length === 0) {
    return undefined;
  }
  const passing = passingVersions(gated);
  if (passing.length === 0) {
    return {
      status: "warning",
      text: "No version passes every gate, so none can be promoted. Change the prompt and run again.",
    };
  }
  const best = passing[passing.length - 1];
  const others =
    passing.length > 1 ? ` ${passing.length} versions pass; pick one below the gates.` : "";
  return {
    status: "info",
    text: `v${best} passes every gate and can be promoted to production.${others}`,
  };
};

const PassFailBadge: React.FC<{passed: boolean; testID?: string}> = ({passed, testID}) => {
  return (
    <Badge
      iconName={passed ? "check" : "xmark"}
      secondary
      status={passed ? "success" : "error"}
      testID={testID}
      value={passed ? "Pass" : "Fail"}
    />
  );
};

interface GateRow {
  dimension: string;
  evaluatorName: string;
  gate: ExperimentGateResult;
  name: string;
  needs: string;
}

/** Unique gates in first-seen order, one row each regardless of version. */
const gateRows = (summaries: VersionGateSummary[]): GateRow[] => {
  const rows: GateRow[] = [];
  const seen = new Set<string>();
  for (const summary of summaries) {
    for (const gate of summary.gates) {
      const key = `${gate.evaluatorName}::${gate.dimension}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        dimension: gate.dimension,
        evaluatorName: gate.evaluatorName,
        gate,
        name: formatGateName(gate),
        needs: formatGateThreshold(gate),
      });
    }
  }
  return rows;
};

const GATE_NAME_MIN_WIDTH = 200;
const GATE_NEEDS_WIDTH = 96;
const GATE_VERSION_MIN_WIDTH = 160;

/** Gate | Needs | one column per version, and a final Result row. */
const GatesTable: React.FC<{summaries: VersionGateSummary[]}> = ({summaries}) => {
  const rows = gateRows(summaries);
  const versionCell = {flex: "grow" as const, minWidth: GATE_VERSION_MIN_WIDTH};
  return (
    <Card gap={3} padding={4} testID="ai-experiment-gates">
      <Box gap={1}>
        <Heading size="sm">Gates</Heading>
        <Text color="secondaryLight" size="sm">
          A version can be promoted only when it passes every gate.
        </Text>
      </Box>
      <Box border="default" rounding="md" testID="ai-experiment-gates-table">
        <Box direction="row" gap={3} paddingX={3} paddingY={2}>
          <Box flex="grow" minWidth={GATE_NAME_MIN_WIDTH}>
            <Text bold size="sm">
              Gate
            </Text>
          </Box>
          <Box width={GATE_NEEDS_WIDTH}>
            <Text bold size="sm">
              Needs
            </Text>
          </Box>
          {summaries.map((summary) => (
            <Box key={summary.version} {...versionCell}>
              <Text bold size="sm">{`v${summary.version}`}</Text>
            </Box>
          ))}
        </Box>
        {rows.map((row) => (
          <Box
            alignItems="center"
            borderTop="default"
            direction="row"
            gap={3}
            key={`${row.evaluatorName}-${row.dimension}`}
            paddingX={3}
            paddingY={2}
          >
            <Box flex="grow" minWidth={GATE_NAME_MIN_WIDTH}>
              <Text>{row.name}</Text>
            </Box>
            <Box width={GATE_NEEDS_WIDTH}>
              <Text>{row.needs}</Text>
            </Box>
            {summaries.map((summary) => {
              const gate = summary.gates.find(
                (entry) =>
                  entry.evaluatorName === row.evaluatorName && entry.dimension === row.dimension
              );
              return (
                <Box
                  alignItems="center"
                  direction="row"
                  gap={2}
                  key={summary.version}
                  testID={`ai-experiment-gate-v${summary.version}-${row.dimension}`}
                  {...versionCell}
                >
                  {gate ? (
                    <>
                      <Text>{formatGateActual(gate.actual)}</Text>
                      <PassFailBadge passed={gate.passed} />
                    </>
                  ) : (
                    <Text color="secondaryLight">—</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
        <Box
          alignItems="center"
          borderTop="default"
          color="baseAlternate"
          direction="row"
          gap={3}
          paddingX={3}
          paddingY={2}
        >
          <Box flex="grow" minWidth={GATE_NAME_MIN_WIDTH}>
            <Text bold>Result</Text>
          </Box>
          <Box width={GATE_NEEDS_WIDTH} />
          {summaries.map((summary) => (
            <Box
              key={summary.version}
              testID={`ai-experiment-gates-v${summary.version}`}
              {...versionCell}
            >
              <Badge
                iconName={
                  summary.gates.length === 0 ? undefined : summary.passed ? "check" : "xmark"
                }
                secondary
                status={
                  summary.gates.length === 0 ? "neutral" : summary.passed ? "success" : "error"
                }
                testID={`ai-experiment-gates-v${summary.version}-verdict`}
                value={formatVersionGateVerdict(summary)}
              />
            </Box>
          ))}
        </Box>
      </Box>
    </Card>
  );
};

const PassFailCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  return (
    <Box alignItems="start" justifyContent="center">
      <PassFailBadge passed={cellData.value === true} />
    </Box>
  );
};

const CUSTOM_COLUMNS = {experimentPassFail: PassFailCell};

export const AiExperimentResultsView: React.FC<AiExperimentResultsViewProps> = ({
  experiment,
  isPromoting,
  onPromote,
  promoteConfirmOpen,
  promoteError,
  promoteVersion,
  onDismissPromoteConfirm,
  onSelectVersion,
}) => {
  const versionSummaries = useMemo(() => summarizeGatesByVersion(experiment), [experiment]);
  const promoteSummary = versionSummaries.find((summary) => summary.version === promoteVersion);
  const blockedReason = promoteSummary ? formatPromoteBlockedReason(promoteSummary) : undefined;
  const hasGates = versionSummaries.some((summary) => summary.gates.length > 0);
  const passing = passingVersions(versionSummaries);
  const verdict = experimentVerdict(versionSummaries);
  const isRunning = experiment.status === "running" || experiment.status === "pending";

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
        {columnType: "experimentPassFail", title: `v${version}`, width: widths.pass},
      ];
    });
    return [{columnType: "text", title: "Item", width: widths.item}, ...versionCols];
  }, [experiment.versions, tableWidth]);

  const itemRows: DataTableCellData[][] = useMemo(() => {
    return experiment.items.map((item, index) => {
      const row: DataTableCellData[] = [{value: `Item ${index + 1}`}];
      for (const version of experiment.versions) {
        const result = item.versionResults[String(version)];
        row.push({value: summarizeOutput(result?.output)});
        const scores = result?.evaluatorScores ?? {};
        const passed =
          Boolean(result) && !result?.error && Object.values(scores).every((entry) => !entry.error);
        row.push({value: passed});
      }
      return row;
    });
  }, [experiment.items, experiment.versions]);

  const itemLabels = useMemo((): Record<string, string> => {
    return Object.fromEntries(
      experiment.items.map((item, index) => [item.datasetItemId, `Item ${index + 1}`])
    );
  }, [experiment.items]);
  const outliers = experiment.results?.outlierItemIds ?? [];

  return (
    <Box gap={4} testID="ai-experiment-results">
      {isRunning ? (
        <Card gap={2} padding={4} testID="ai-experiment-results-running">
          <Text bold>Running</Text>
          <ProgressMeter
            done={experiment.results?.progress.completed ?? 0}
            testID="ai-experiment-results-progress"
            total={experiment.results?.progress.total ?? 0}
          />
        </Card>
      ) : null}
      {verdict ? (
        <Box testID="ai-experiment-verdict">
          <Banner hasIcon status={verdict.status} text={verdict.text} />
        </Box>
      ) : null}
      {hasGates ? <GatesTable summaries={versionSummaries} /> : null}
      {blockedReason && passing.length === 0 ? (
        <Text color="secondaryLight" size="sm" testID="ai-experiment-gates-failing">
          {blockedReason}
        </Text>
      ) : null}
      {passing.length > 1 ? (
        <Box maxWidth={240} testID="ai-experiment-promote-version">
          <SelectField
            onChange={(value) => {
              onSelectVersion(Number(value));
            }}
            options={passing.map((version) => {
              return {label: `v${version}`, value: String(version)};
            })}
            requireValue
            title="Version to promote"
            value={String(promoteVersion)}
          />
        </Box>
      ) : null}
      {promoteError ? (
        <Box testID="ai-experiment-promote-error">
          <Banner hasIcon status="alert" text={promoteError} />
        </Box>
      ) : null}
      {outliers.length > 0 ? (
        <Box gap={2} testID="ai-experiment-outliers">
          <Text bold>Outliers</Text>
          <Box direction="row" gap={1} wrap>
            {outliers.map((itemId) => {
              return (
                <Badge
                  key={itemId}
                  secondary
                  status="warning"
                  value={itemLabels[itemId] ?? `Item ${itemId.slice(-6)}`}
                />
              );
            })}
          </Box>
        </Box>
      ) : null}
      <Card gap={3} padding={4}>
        <Heading size="sm">Outputs</Heading>
        {experiment.items.length === 0 ? (
          <ObservabilityEmptyState
            description={
              isRunning
                ? "Outputs appear here as each item finishes."
                : "This experiment has no item outputs."
            }
            iconName="list"
            testID="ai-experiment-items-empty"
            title="No outputs yet"
          />
        ) : (
          <Box
            onLayout={handleTableLayout}
            testID="ai-experiment-items-table-container"
            width="100%"
          >
            <DataTable
              columns={itemColumns}
              customColumnComponentMap={CUSTOM_COLUMNS}
              data={itemRows}
              rowHeight={ITEM_ROW_HEIGHT}
              testID="ai-experiment-items-table"
            />
          </Box>
        )}
      </Card>
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
            {`Promote v${promoteVersion} of ${experiment.promptName} to production? New traffic uses it right away.`}
          </Text>
          {blockedReason ? <Text color="error">{blockedReason}</Text> : null}
        </Box>
      </Modal>
    </Box>
  );
};
