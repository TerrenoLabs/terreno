import {
  Badge,
  Box,
  DataTable,
  type DataTableCellData,
  type IconName,
  SegmentedControl,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {AgreementMeter} from "../shell/AgreementMeter";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {
  EVALUATOR_TYPE_LABELS,
  type EvaluatorRecord,
  formatDimensionSummary,
  formatRunModeChips,
} from "./evaluatorTypes";

export interface AiEvaluatorsListViewProps {
  /** Shows the empty state's New evaluator action; the header owns the main button. */
  canCreate?: boolean;
  evaluators: EvaluatorRecord[];
  isLoading: boolean;
  loadError?: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}

/** Icon per evaluator kind. Kind badges stay neutral: colour means state, not category. */
const EVALUATOR_TYPE_ICONS: Record<EvaluatorRecord["type"], IconName> = {
  human: "user",
  "json-assert": "code",
  "llm-judge": "gavel",
};

/** Readable target labels, e.g. "full trace" -> "Full trace". */
export const EVALUATOR_TARGET_LABELS: Record<EvaluatorRecord["target"], string> = {
  "dataset item": "Dataset item",
  "full trace": "Full trace",
  "generation span": "One AI step",
};

const KIND_FILTERS: Array<{label: string; type?: EvaluatorRecord["type"]}> = [
  {label: "All"},
  {label: EVALUATOR_TYPE_LABELS.human, type: "human"},
  {label: EVALUATOR_TYPE_LABELS["llm-judge"], type: "llm-judge"},
  {label: EVALUATOR_TYPE_LABELS["json-assert"], type: "json-assert"},
];

const runModesText = (evaluator: EvaluatorRecord): string | undefined => {
  if (evaluator.type === "human") {
    return "People in review";
  }
  const chips = formatRunModeChips(evaluator.runModes);
  return chips.length > 0 ? chips.join(" · ") : undefined;
};

const evaluatorSearchText = (evaluator: EvaluatorRecord): string => evaluator.name;

const buildColumns = (evaluators: EvaluatorRecord[]): ClientTableColumn<EvaluatorRecord>[] => {
  const hasCalibration = evaluators.some((evaluator) => evaluator.calibration);
  const columns: ClientTableColumn<EvaluatorRecord>[] = [
    {
      cell: (evaluator) => ({value: evaluator}),
      columnType: "evaluatorName",
      filter: {kind: "text"},
      key: "name",
      title: "Evaluator",
      value: (evaluator) => evaluator.name,
      width: 280,
    },
    {
      columnType: "evaluatorType",
      filter: {
        kind: "choice",
        options: distinctChoiceOptions(evaluators, (evaluator) => evaluator.type).map((option) => ({
          label: EVALUATOR_TYPE_LABELS[option.value as EvaluatorRecord["type"]] ?? option.value,
          value: option.value,
        })),
      },
      key: "type",
      title: "Kind",
      value: (evaluator) => evaluator.type,
      width: 160,
    },
    {
      cell: (evaluator) => ({value: formatDimensionSummary(evaluator.dimensions)}),
      filter: {kind: "text"},
      key: "dimensions",
      title: "Scores",
      value: (evaluator) =>
        evaluator.dimensions.length > 0 ? formatDimensionSummary(evaluator.dimensions) : undefined,
      width: 220,
    },
    {
      cell: (evaluator) => ({value: EVALUATOR_TARGET_LABELS[evaluator.target] ?? evaluator.target}),
      filter: {
        kind: "choice",
        options: distinctChoiceOptions(evaluators, (evaluator) => evaluator.target).map(
          (option) => ({
            label:
              EVALUATOR_TARGET_LABELS[option.value as EvaluatorRecord["target"]] ?? option.value,
            value: option.value,
          })
        ),
      },
      key: "target",
      title: "Looks at",
      value: (evaluator) => evaluator.target,
      width: 150,
    },
    {
      cell: (evaluator) => ({value: runModesText(evaluator) ?? "—"}),
      filter: {kind: "text"},
      key: "runModes",
      title: "Runs in",
      value: runModesText,
      width: 220,
    },
  ];
  if (hasCalibration) {
    columns.push({
      cell: (evaluator) => ({value: evaluator}),
      columnType: "evaluatorCalibration",
      filter: {kind: "numberRange", label: "Agreement %"},
      key: "calibration",
      title: "Agrees with people",
      value: (evaluator) =>
        evaluator.calibration?.rate !== undefined
          ? Math.round(evaluator.calibration.rate * 100)
          : undefined,
      width: 210,
    });
  }
  return columns;
};

/** Neutral kind badge with an icon, e.g. a gavel for LLM judges. */
export const EvaluatorKindBadge: React.FC<{testID?: string; type: EvaluatorRecord["type"]}> = ({
  testID,
  type,
}) => {
  return (
    <Badge
      iconName={EVALUATOR_TYPE_ICONS[type]}
      secondary
      status="neutral"
      testID={testID}
      value={EVALUATOR_TYPE_LABELS[type] ?? type}
    />
  );
};

const TypeBadgeCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const type = String(cellData.value) as EvaluatorRecord["type"];
  return (
    <Box alignItems="start" justifyContent="center">
      <EvaluatorKindBadge testID={`ai-evaluator-type-${type}`} type={type} />
    </Box>
  );
};

const CalibrationCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const evaluator = cellData.value as EvaluatorRecord;
  if (evaluator.type !== "llm-judge") {
    return (
      <Box justifyContent="center">
        <Text color="secondaryLight">—</Text>
      </Box>
    );
  }
  return (
    <Box justifyContent="center">
      <AgreementMeter
        compact
        rate={evaluator.calibration?.rate}
        testID={`ai-evaluator-calibration-${evaluator.id}`}
      />
    </Box>
  );
};

export const AiEvaluatorsListView: React.FC<AiEvaluatorsListViewProps> = ({
  canCreate = true,
  evaluators,
  isLoading,
  loadError,
  onCreate,
  onOpen,
  onRetry,
}) => {
  const [kindIndex, setKindIndex] = useState(0);
  const kindType = KIND_FILTERS[kindIndex]?.type;

  const kindRows = useMemo(() => {
    if (!kindType) {
      return evaluators;
    }
    return evaluators.filter((evaluator) => evaluator.type === kindType);
  }, [evaluators, kindType]);

  const kindBadges = useMemo(() => {
    return KIND_FILTERS.map((entry) => ({
      count: entry.type
        ? evaluators.filter((evaluator) => evaluator.type === entry.type).length
        : evaluators.length,
      status: "neutral" as const,
    }));
  }, [evaluators]);

  const handleKindChange = useCallback((index: number): void => {
    setKindIndex(index);
  }, []);

  const customColumnComponentMap = useMemo(
    () => ({
      evaluatorCalibration: CalibrationCell,
      evaluatorName: ({cellData}: {cellData: DataTableCellData}) => {
        const evaluator = cellData.value as EvaluatorRecord;
        return (
          <Box
            accessibilityHint="Opens the evaluator"
            accessibilityLabel={`Open evaluator ${evaluator.name}`}
            flex="grow"
            gap={1}
            justifyContent="center"
            onClick={() => {
              onOpen(evaluator.id);
            }}
          >
            <Box testID={`ai-evaluator-open-${evaluator.id}`}>
              <Text bold numberOfLines={1}>
                {evaluator.name}
              </Text>
            </Box>
            {evaluator.description ? (
              <Text color="secondaryLight" numberOfLines={1} size="sm">
                {evaluator.description}
              </Text>
            ) : null}
          </Box>
        );
      },
      evaluatorType: TypeBadgeCell,
    }),
    [onOpen]
  );

  const columns = useMemo(() => buildColumns(evaluators), [evaluators]);
  const {rows: _sortedEvaluators, ...table} = useClientTable({
    columns,
    rows: kindRows,
    searchText: evaluatorSearchText,
  });

  const renderBody = (): React.ReactNode => {
    if (isLoading) {
      return (
        <Box alignItems="center" padding={5} testID="ai-evaluators-loading">
          <Spinner />
        </Box>
      );
    }
    if (loadError) {
      return (
        <ObservabilityErrorState
          onRetry={onRetry}
          testID="ai-evaluators-load-error"
          text={loadError}
        />
      );
    }
    if (evaluators.length === 0) {
      return (
        <ObservabilityEmptyState
          actionIconName="plus"
          actionText={canCreate ? "New evaluator" : undefined}
          description="Create one to score traces, datasets and experiments."
          iconName="gavel"
          onAction={canCreate ? onCreate : undefined}
          testID="ai-evaluators-empty"
          title="No evaluators yet"
        />
      );
    }
    return (
      <DataTable
        {...table}
        customColumnComponentMap={customColumnComponentMap}
        emptyContent={
          <ObservabilityEmptyState
            description="Pick another kind or clear a filter."
            iconName="filter"
            testID="ai-evaluators-no-matches"
            title="No evaluators match"
          />
        }
        rowHeight={64}
        testID="ai-evaluators-table"
      />
    );
  };

  return (
    <Box gap={4} testID="ai-evaluators-list">
      {!isLoading && !loadError && evaluators.length > 0 ? (
        <Box alignItems="start" testID="ai-evaluators-kind-filter">
          <SegmentedControl
            badges={kindBadges}
            items={KIND_FILTERS.map((entry) => entry.label)}
            onChange={handleKindChange}
            selectedIndex={kindIndex}
            size="sm"
          />
        </Box>
      ) : null}
      {renderBody()}
    </Box>
  );
};
