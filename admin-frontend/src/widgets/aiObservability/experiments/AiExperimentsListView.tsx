import {
  Badge,
  Box,
  DataTable,
  type DataTableCellData,
  SegmentedControl,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {ProgressMeter} from "../shell/AgreementMeter";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {EvalPipelineOverview} from "../shell/EvalPipelineOverview";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {ObservabilityStatusBadge} from "../shell/ObservabilityStatusBadge";
import {getObservabilityStatusStyle} from "../shell/observabilityStatus";
import {
  EXPERIMENT_KIND_LABELS,
  type ExperimentKind,
  type ExperimentRecord,
  experimentKind,
  failingGateCount,
  formatExperimentCost,
  summarizeGatesByVersion,
} from "./experimentTypes";

export interface AiExperimentsListViewProps {
  /** Shows the empty state's "New experiment" action. */
  canCreate?: boolean;
  /** Dataset names by id; the table falls back to the payload name, then the id. */
  datasetNames?: Record<string, string>;
  experiments: ExperimentRecord[];
  isLoading: boolean;
  loadError?: string;
  onCreate: () => void;
  onOpenResults: (id: string) => void;
  onRetry: () => void;
}

type KindFilter = "all" | ExperimentKind;

const KIND_FILTERS: KindFilter[] = ["all", "judge", "prompt"];
const KIND_FILTER_LABELS = ["All", EXPERIMENT_KIND_LABELS.judge, EXPERIMENT_KIND_LABELS.prompt];

const ROW_HEIGHT = 64;

interface NameCellValue {
  id: string;
  kind: string;
  name: string;
}

interface StatusCellValue {
  completed: number;
  id: string;
  status: ExperimentRecord["status"];
  total: number;
}

interface ResultCellValue {
  id: string;
  passed: boolean;
  text: string;
}

const experimentCost = (experiment: ExperimentRecord): number | undefined => {
  return experiment.results?.totalCostUsd ?? experiment.estimate?.costUsd;
};

/**
 * One gate verdict per experiment: the highest version that passes every gate, or how many gates
 * the closest version fails. Undefined before any gate has a score.
 */
export const experimentResultVerdict = (
  experiment: ExperimentRecord
): {passed: boolean; text: string} | undefined => {
  const summaries = summarizeGatesByVersion(experiment).filter((entry) => entry.gates.length > 0);
  if (summaries.length === 0) {
    return undefined;
  }
  const passing = summaries.filter((entry) => entry.passed);
  const best = passing[passing.length - 1];
  if (best) {
    return {passed: true, text: `v${best.version} ready to promote`};
  }
  const closest = [...summaries].sort(
    (left, right) => left.failing.length - right.failing.length
  )[0];
  if (!closest) {
    return undefined;
  }
  return {
    passed: false,
    text: `Fails ${closest.failing.length} of ${closest.gates.length} ${
      closest.gates.length === 1 ? "gate" : "gates"
    }`,
  };
};

const statusLabel = (experiment: ExperimentRecord): string => {
  return getObservabilityStatusStyle({status: experiment.status}).label;
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
    cell: (experiment) => ({
      value: {
        id: experiment.id,
        kind: EXPERIMENT_KIND_LABELS[experimentKind(experiment)],
        name: experiment.name,
      } satisfies NameCellValue,
    }),
    columnType: "experimentName",
    filter: {kind: "text"},
    key: "name",
    title: "Experiment",
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
    cell: (experiment) => ({
      value: {
        completed: experiment.results?.progress.completed ?? 0,
        id: experiment.id,
        status: experiment.status,
        total: experiment.results?.progress.total ?? 0,
      } satisfies StatusCellValue,
    }),
    columnType: "experimentStatus",
    filter: {kind: "choice", options: distinctChoiceOptions(experiments, statusLabel)},
    key: "status",
    title: "Status",
    value: statusLabel,
    width: 180,
  },
  {
    cell: (experiment) => {
      const verdict = experimentResultVerdict(experiment);
      return {
        value: verdict
          ? ({id: experiment.id, ...verdict} satisfies ResultCellValue)
          : {id: experiment.id, passed: false, text: ""},
      };
    },
    columnType: "experimentResult",
    filter: {kind: "numberRange", label: "Failing gates"},
    key: "result",
    title: "Result",
    value: (experiment) => (experiment.results ? failingGateCount(experiment) : undefined),
    width: 220,
  },
  {
    cell: (experiment) => ({value: formatExperimentCost(experimentCost(experiment))}),
    filter: {kind: "numberRange"},
    key: "cost",
    title: "Cost",
    value: experimentCost,
    width: 110,
  },
];

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
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const handleKindChange = useCallback((index: number): void => {
    setKindFilter(KIND_FILTERS[index] ?? "all");
  }, []);

  const visibleExperiments = useMemo(() => {
    if (kindFilter === "all") {
      return experiments;
    }
    return experiments.filter((experiment) => experimentKind(experiment) === kindFilter);
  }, [experiments, kindFilter]);

  const customColumnComponentMap = useMemo(
    () => ({
      experimentName: ({cellData}: {cellData: DataTableCellData}) => {
        const value = cellData.value as NameCellValue;
        return (
          <Box
            accessibilityHint="Open the experiment results"
            accessibilityLabel={`Open ${value.name}`}
            justifyContent="center"
            onClick={() => {
              onOpenResults(value.id);
            }}
          >
            <Box gap={1} testID={`ai-experiment-open-${value.id}`}>
              <Text bold numberOfLines={1}>
                {value.name}
              </Text>
              <Text color="secondaryLight" size="sm">
                {value.kind}
              </Text>
            </Box>
          </Box>
        );
      },
      experimentResult: ({cellData}: {cellData: DataTableCellData}) => {
        const value = cellData.value as ResultCellValue;
        if (!value.text) {
          return (
            <Box justifyContent="center">
              <Text color="secondaryLight">—</Text>
            </Box>
          );
        }
        return (
          <Box alignItems="start" justifyContent="center">
            <Badge
              iconName={value.passed ? "check" : "xmark"}
              secondary
              status={value.passed ? "success" : "error"}
              testID={`ai-experiment-result-${value.id}`}
              value={value.text}
            />
          </Box>
        );
      },
      experimentStatus: ({cellData}: {cellData: DataTableCellData}) => {
        const value = cellData.value as StatusCellValue;
        if (value.status === "running") {
          return (
            <Box gap={1} justifyContent="center" width="100%">
              <ObservabilityStatusBadge
                label={`Running ${value.completed} of ${value.total}`}
                status="running"
              />
              <ProgressMeter
                done={value.completed}
                testID={`ai-experiments-progress-${value.id}`}
                total={value.total}
              />
            </Box>
          );
        }
        return (
          <Box alignItems="start" justifyContent="center">
            <ObservabilityStatusBadge status={value.status} />
          </Box>
        );
      },
    }),
    [onOpenResults]
  );

  const columns = useMemo(
    () =>
      buildColumns({
        datasetName: (experiment) =>
          datasetNames?.[experiment.datasetId] ?? experiment.datasetName ?? experiment.datasetId,
        experiments: visibleExperiments,
      }),
    [datasetNames, visibleExperiments]
  );
  const {rows: _sortedExperiments, ...table} = useClientTable({
    columns,
    rows: visibleExperiments,
    searchText: experimentSearchText,
  });

  const renderBody = (): React.ReactNode => {
    if (loadError) {
      return (
        <ObservabilityErrorState onRetry={onRetry} testID="ai-experiments-error" text={loadError} />
      );
    }
    if (isLoading) {
      return (
        <Box alignItems="center" padding={5} testID="ai-experiments-loading">
          <Spinner />
        </Box>
      );
    }
    if (experiments.length === 0) {
      return (
        <ObservabilityEmptyState
          actionIconName="flask"
          actionText={canCreate ? "New experiment" : undefined}
          description="Run a dataset through a judge or through prompt versions to see which one passes its gates."
          iconName="flask"
          onAction={canCreate ? onCreate : undefined}
          testID="ai-experiments-empty"
          title="No experiments yet"
        />
      );
    }
    return (
      <Box gap={3}>
        <Box alignItems="start">
          <SegmentedControl
            items={KIND_FILTER_LABELS}
            onChange={handleKindChange}
            selectedIndex={KIND_FILTERS.indexOf(kindFilter)}
            size="sm"
            testID="ai-experiments-kind-filter"
          />
        </Box>
        <DataTable
          {...table}
          customColumnComponentMap={customColumnComponentMap}
          emptyContent={
            <Box padding={4} testID="ai-experiments-no-matches">
              <Text color="secondaryLight">No experiments match these filters.</Text>
            </Box>
          }
          rowHeight={ROW_HEIGHT}
          testID="ai-experiments-table"
        />
      </Box>
    );
  };

  return (
    <Box gap={4} testID="ai-experiments-list">
      <EvalPipelineOverview currentSteps={[3, 4]} />
      {renderBody()}
    </Box>
  );
};
