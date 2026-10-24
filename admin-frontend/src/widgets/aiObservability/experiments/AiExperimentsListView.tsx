import {Badge, Box, Button, DataTable, type DataTableCellData, Text} from "@terreno/ui";
import React, {useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {
  type ExperimentRecord,
  experimentProgressPercent,
  failingGateCount,
} from "./experimentTypes";

export interface AiExperimentsListViewProps {
  canCreate?: boolean;
  /** Dataset names by id; the table falls back to the id when a dataset is missing. */
  datasetNames?: Record<string, string>;
  experiments: ExperimentRecord[];
  isLoading: boolean;
  loadError?: string;
  onCreate: () => void;
  onOpenResults: (id: string) => void;
  onRetry: () => void;
}

const experimentCost = (experiment: ExperimentRecord): number | undefined => {
  return experiment.results?.totalCostUsd ?? experiment.estimate?.costUsd;
};

const isInFlight = (experiment: ExperimentRecord): boolean => {
  return experiment.status === "running" || experiment.status === "pending";
};

const experimentSearchText = (experiment: ExperimentRecord): string => experiment.name;

const buildColumns = ({
  datasetName,
  experiments,
}: {
  datasetName: (experiment: ExperimentRecord) => string;
  experiments: ExperimentRecord[];
}): ClientTableColumn<ExperimentRecord>[] => [
  {
    filter: {kind: "text"},
    key: "name",
    title: "Name",
    value: (experiment) => experiment.name,
    // Fits seeded names such as "Summarize v2 vs v3 (length cap)" on one line.
    width: 300,
  },
  {
    filter: {kind: "choice", options: distinctChoiceOptions(experiments, datasetName)},
    key: "dataset",
    title: "Dataset",
    value: datasetName,
    // Fits seeded names such as "example-summarize-gold" on one line.
    width: 240,
  },
  {
    columnType: "experimentStatus",
    filter: {
      kind: "choice",
      options: distinctChoiceOptions(experiments, (experiment) => experiment.status),
    },
    key: "status",
    title: "Status",
    value: (experiment) => experiment.status,
    width: 140,
  },
  {
    cell: (experiment) => ({
      value: isInFlight(experiment) ? `${experimentProgressPercent(experiment)}%` : "—",
    }),
    filter: {kind: "numberRange"},
    key: "progress",
    title: "Progress",
    value: (experiment) =>
      isInFlight(experiment) ? experimentProgressPercent(experiment) : undefined,
    width: 160,
  },
  {
    cell: (experiment) => {
      const cost = experimentCost(experiment);
      return {value: cost !== undefined ? `$${cost.toFixed(2)}` : "—"};
    },
    filter: {kind: "numberRange"},
    key: "cost",
    title: "Cost",
    value: experimentCost,
    width: 130,
  },
  {
    cell: (experiment) => ({value: experiment.id}),
    columnType: "experimentOpen",
    key: "open",
    title: "",
    width: 88,
  },
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
  datasetNames,
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

  const columns = useMemo(
    () =>
      buildColumns({
        datasetName: (experiment) => datasetNames?.[experiment.datasetId] ?? experiment.datasetId,
        experiments,
      }),
    [datasetNames, experiments]
  );
  const {rows: _sortedExperiments, ...table} = useClientTable({
    columns,
    rows: experiments,
    searchText: experimentSearchText,
  });

  return (
    <Box gap={3} testID="ai-experiments-list">
      <Box direction="row" gap={2} justifyContent="between" wrap>
        <Text color="secondaryDark" size="sm">
          Experiments run via BackgroundTask locally.
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
          {...table}
          customColumnComponentMap={customColumnComponentMap}
          emptyContent={
            <Box padding={4} testID="ai-experiments-no-matches">
              <Text color="secondaryDark">No experiments match these filters.</Text>
            </Box>
          }
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
