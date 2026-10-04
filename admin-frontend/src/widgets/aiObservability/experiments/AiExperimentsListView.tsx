import {
  Badge,
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  Text,
} from "@terreno/ui";
import React, {useMemo} from "react";
import {
  type ExperimentRecord,
  experimentProgressPercent,
  failingGateCount,
} from "./experimentTypes";

export interface AiExperimentsListViewProps {
  canCreate?: boolean;
  experiments: ExperimentRecord[];
  isLoading: boolean;
  loadError?: string;
  onCreate: () => void;
  onOpenResults: (id: string) => void;
  onRetry: () => void;
}

const COLUMNS: DataTableColumn[] = [
  {columnType: "text", title: "Name", width: 180},
  {columnType: "text", title: "Dataset", width: 140},
  {columnType: "experimentStatus", title: "Status", width: 120},
  {columnType: "text", title: "Progress", width: 160},
  {columnType: "text", title: "Cost", width: 100},
  {columnType: "experimentOpen", title: "", width: 88},
];

const statusBadge = (
  status: ExperimentRecord["status"]
): "error" | "info" | "neutral" | "success" | "warning" => {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "running") {
    return "info";
  }
  return "warning";
};

const StatusCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box justifyContent="center">
    <Badge
      status={statusBadge(String(cellData.value) as ExperimentRecord["status"])}
      value={String(cellData.value ?? "")}
    />
  </Box>
);

export const AiExperimentsListView: React.FC<AiExperimentsListViewProps> = ({
  canCreate = true,
  experiments,
  isLoading,
  loadError,
  onCreate,
  onOpenResults,
  onRetry,
}) => {
  const customColumnComponentMap = useMemo(
    () => ({
      experimentOpen: ({cellData}: {cellData: DataTableCellData}) => (
        <Box justifyContent="center">
          <Button
            onClick={() => {
              onOpenResults(String(cellData.value ?? ""));
            }}
            size="sm"
            testID={`ai-experiment-open-${String(cellData.value ?? "")}`}
            text="Open"
            variant="outline"
          />
        </Box>
      ),
      experimentStatus: StatusCell,
    }),
    [onOpenResults]
  );

  const rows: DataTableCellData[][] = useMemo(() => {
    return experiments.map((experiment) => {
      const percent = experimentProgressPercent(experiment);
      const cost = experiment.results?.totalCostUsd ?? experiment.estimate?.costUsd;
      return [
        {value: experiment.name},
        {value: experiment.datasetId},
        {value: experiment.status},
        {
          value:
            experiment.status === "running" || experiment.status === "pending"
              ? `${percent}%`
              : "—",
        },
        {value: cost !== undefined ? `$${cost.toFixed(2)}` : "—"},
        {value: experiment.id},
      ];
    });
  }, [experiments]);

  return (
    <Box gap={3} testID="ai-experiments-list">
      <Box direction="row" gap={2} justifyContent="between" wrap>
        <Text color="secondaryDark" size="sm">
          Experiments run via BackgroundTask locally. Langfuse deep-links when the remote plugin is
          primary.
        </Text>
        {canCreate ? (
          <Button onClick={onCreate} testID="ai-experiments-create" text="New experiment" />
        ) : undefined}
      </Box>
      {loadError ? (
        <Box gap={2}>
          <Text color="error">{loadError}</Text>
          <Button onClick={onRetry} text="Retry" variant="secondary" />
        </Box>
      ) : undefined}
      {isLoading ? (
        <Box padding={4} testID="ai-experiments-loading">
          <Text>Loading experiments…</Text>
        </Box>
      ) : experiments.length === 0 ? (
        <Box padding={4} testID="ai-experiments-empty">
          <Text color="secondaryDark">No experiments yet.</Text>
        </Box>
      ) : (
        <DataTable
          columns={COLUMNS}
          customColumnComponentMap={customColumnComponentMap}
          data={rows}
          testID="ai-experiments-table"
        />
      )}
      {experiments
        .filter((experiment) => experiment.status === "running")
        .map((experiment) => {
          const percent = experimentProgressPercent(experiment);
          return (
            <Box gap={1} key={experiment.id} testID={`ai-experiments-progress-${experiment.id}`}>
              <Text size="sm">
                {experiment.name}: {percent}%
              </Text>
              <Box color="secondaryLight" height={8} width="100%">
                <Box color="primary" height={8} width={`${percent}%`} />
              </Box>
            </Box>
          );
        })}
      {experiments.map((experiment) => {
        const failing = failingGateCount(experiment);
        if (failing === 0) {
          return undefined;
        }
        return (
          <Badge key={`fail-${experiment.id}`} status="error" value={`${failing} gates failing`} />
        );
      })}
    </Box>
  );
};
