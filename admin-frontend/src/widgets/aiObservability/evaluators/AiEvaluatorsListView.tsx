import {Badge, Box, Button, DataTable, type DataTableCellData, Text} from "@terreno/ui";
import React, {useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {
  EVALUATOR_TYPE_LABELS,
  type EvaluatorRecord,
  formatDimensionSummary,
  formatRunModeChips,
} from "./evaluatorTypes";

export interface AiEvaluatorsListViewProps {
  canCreate?: boolean;
  evaluators: EvaluatorRecord[];
  isLoading: boolean;
  loadError?: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}

const runModesText = (evaluator: EvaluatorRecord): string | undefined => {
  const chips = formatRunModeChips(evaluator.runModes);
  return chips.length > 0 ? chips.join(" · ") : undefined;
};

const evaluatorSearchText = (evaluator: EvaluatorRecord): string => evaluator.name;

const buildColumns = (evaluators: EvaluatorRecord[]): ClientTableColumn<EvaluatorRecord>[] => [
  {
    filter: {kind: "text"},
    key: "name",
    title: "Name",
    value: (evaluator) => evaluator.name,
    width: 240,
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
    title: "Type",
    value: (evaluator) => evaluator.type,
    width: 150,
  },
  {
    cell: (evaluator) => ({value: formatDimensionSummary(evaluator.dimensions)}),
    filter: {kind: "text"},
    key: "dimensions",
    title: "Dimensions",
    value: (evaluator) =>
      evaluator.dimensions.length > 0 ? formatDimensionSummary(evaluator.dimensions) : undefined,
    width: 220,
  },
  {
    filter: {
      kind: "choice",
      options: distinctChoiceOptions(evaluators, (evaluator) => evaluator.target),
    },
    key: "target",
    title: "Target",
    value: (evaluator) => evaluator.target,
    width: 170,
  },
  {
    cell: (evaluator) => ({value: runModesText(evaluator) ?? "—"}),
    filter: {kind: "text"},
    key: "runModes",
    title: "Run modes",
    value: runModesText,
    width: 240,
  },
  {
    cell: (evaluator) => ({value: evaluator.id}),
    columnType: "evaluatorOpen",
    key: "open",
    title: "",
    width: 88,
  },
];

const typeBadgeStatus = (type: EvaluatorRecord["type"]): "info" | "neutral" | "warning" => {
  if (type === "human") {
    return "neutral";
  }
  if (type === "llm-judge") {
    return "info";
  }
  return "warning";
};

const TypeBadgeCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const type = String(cellData.value) as EvaluatorRecord["type"];
  return (
    <Box justifyContent="center">
      <Badge
        status={typeBadgeStatus(type)}
        testID={`ai-evaluator-type-${type}`}
        value={EVALUATOR_TYPE_LABELS[type]}
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
  const customColumnComponentMap = useMemo(
    () => ({
      evaluatorOpen: ({cellData}: {cellData: DataTableCellData}) => (
        <Box justifyContent="center">
          <Button
            onClick={() => {
              onOpen(String(cellData.value ?? ""));
            }}
            size="sm"
            testID={`ai-evaluator-open-${String(cellData.value ?? "")}`}
            text="Open"
            variant="outline"
          />
        </Box>
      ),
      evaluatorType: TypeBadgeCell,
    }),
    [onOpen]
  );

  const columns = useMemo(() => buildColumns(evaluators), [evaluators]);
  const {rows: _sortedEvaluators, ...table} = useClientTable({
    columns,
    rows: evaluators,
    searchText: evaluatorSearchText,
  });

  return (
    <Box gap={3} testID="ai-evaluators-list">
      <Box direction="row" gap={2} justifyContent="between" wrap>
        <Text color="secondaryDark" size="sm">
          Schema is checked on save. Live sampling bills judge calls at the configured rate.
        </Text>
        {canCreate ? (
          <Button onClick={onCreate} testID="ai-evaluators-create" text="Create evaluator" />
        ) : undefined}
      </Box>
      {loadError ? (
        <Box gap={2} testID="ai-evaluators-load-error">
          <Text color="error">{loadError}</Text>
          <Button onClick={onRetry} text="Retry" variant="secondary" />
        </Box>
      ) : undefined}
      {isLoading ? (
        <Box padding={4} testID="ai-evaluators-loading">
          <Text>Loading evaluators…</Text>
        </Box>
      ) : evaluators.length === 0 ? (
        <Box padding={4} testID="ai-evaluators-empty">
          <Text color="secondaryDark">
            No evaluators yet. Create one to score traces and experiments.
          </Text>
        </Box>
      ) : (
        <DataTable
          {...table}
          customColumnComponentMap={customColumnComponentMap}
          emptyContent={
            <Box padding={4} testID="ai-evaluators-no-matches">
              <Text color="secondaryDark">No evaluators match these filters.</Text>
            </Box>
          }
          testID="ai-evaluators-table"
        />
      )}
    </Box>
  );
};
