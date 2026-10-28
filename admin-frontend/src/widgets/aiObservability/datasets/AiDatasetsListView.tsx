import {
  Badge,
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  FilePickerButton,
  Modal,
  Spinner,
  Text,
  TextArea,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useMemo} from "react";
import {MeterBar} from "../shell/AgreementMeter";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {detectImportFormat} from "./datasetImport";
import type {DatasetImportResult, DatasetRecord} from "./datasetTypes";

export interface AiDatasetsListViewProps {
  canCreate?: boolean;
  canImport?: boolean;
  createError?: string;
  createName: string;
  createOpen: boolean;
  createPromptBinding: string;
  datasets: DatasetRecord[];
  importDatasetId?: string;
  importError?: string;
  importFilename?: string;
  importFormat?: "csv" | "json";
  importOpen: boolean;
  importPaste: string;
  importPreview?: string;
  importResult?: DatasetImportResult;
  isCreating: boolean;
  isImporting: boolean;
  isLoading: boolean;
  loadError?: string;
  onCreate: () => void;
  onCreateNameChange: (value: string) => void;
  onCreatePromptBindingChange: (value: string) => void;
  onDismissCreate: () => void;
  onDismissImport: () => void;
  onFilePicked: (args: {content: string; filename: string}) => void;
  /** Called when a chosen file cannot be read, so the screen can say so. */
  onFileReadError?: (message: string) => void;
  /** Opens Traces, where people pick traces to save as a dataset. */
  onGoToTraces?: () => void;
  onImportPasteChange: (value: string) => void;
  onImportSubmit: () => void;
  /** Kept for callers; the screen header now owns the New dataset button. */
  onOpenCreate?: () => void;
  onOpenDetail: (id: string) => void;
  onOpenImport: (datasetId: string) => void;
  onRetry: () => void;
}

const FILE_READ_ERROR = "Could not read that file. Try again, or paste its contents below.";

const formatUpdated = (iso: string): string => {
  const parsed = DateTime.fromISO(iso);
  if (!parsed.isValid) {
    return iso;
  }
  return parsed.toRelative() ?? iso;
};

const humanShare = (dataset: DatasetRecord): number | undefined => {
  if (dataset.counts.total === 0) {
    return undefined;
  }
  return Math.round((dataset.counts.human / dataset.counts.total) * 100);
};

/** Items still to proofread across every question set that answered this dataset. */
const answersToCheck = (dataset: DatasetRecord): number => {
  return dataset.counts.needsReview;
};

const datasetSearchText = (dataset: DatasetRecord): string => dataset.name;

const buildColumns = (datasets: DatasetRecord[]): ClientTableColumn<DatasetRecord>[] => {
  const hasJudgments = datasets.some((dataset) => (dataset.judgments ?? []).length > 0);
  const columns: ClientTableColumn<DatasetRecord>[] = [
    {
      cell: (dataset) => ({value: dataset}),
      columnType: "datasetName",
      filter: {kind: "text"},
      key: "name",
      title: "Dataset",
      value: (dataset) => dataset.name,
      width: 260,
    },
    {
      cell: (dataset) => ({value: dataset.counts.total.toLocaleString("en-US")}),
      columnType: "number",
      filter: {kind: "numberRange"},
      key: "items",
      title: "Items",
      value: (dataset) => dataset.counts.total,
      width: 120,
    },
    {
      // Sorts and filters by the proofread share shown in the bar.
      cell: (dataset) => ({value: dataset}),
      columnType: "datasetSource",
      filter: {kind: "numberRange", label: "Proofread %"},
      key: "provenance",
      title: "Source",
      value: humanShare,
      width: 240,
    },
  ];
  if (hasJudgments) {
    columns.push({
      cell: (dataset) => ({value: dataset}),
      columnType: "datasetAnswers",
      key: "answers",
      sortable: false,
      title: "People's answers",
      width: 220,
    });
  }
  columns.push(
    {
      cell: (dataset) => ({value: dataset.inputSchemaPromptName ?? "—"}),
      filter: {
        kind: "choice",
        options: distinctChoiceOptions(datasets, (dataset) => dataset.inputSchemaPromptName),
      },
      key: "schemaBinding",
      title: "Prompt",
      value: (dataset) => dataset.inputSchemaPromptName,
      width: 200,
    },
    {
      cell: (dataset) => ({value: formatUpdated(dataset.updated)}),
      filter: {kind: "dateRange"},
      key: "updated",
      title: "Updated",
      value: (dataset) => dataset.updated,
      width: 160,
    },
    {
      cell: (dataset) => ({value: dataset.id}),
      columnType: "datasetImport",
      key: "import",
      title: "Add items",
      width: 140,
    }
  );
  return columns;
};

const NumberCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box flex="grow" justifyContent="center" width="100%">
    <Text align="right">{String(cellData.value ?? "")}</Text>
  </Box>
);

const SourceCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const dataset = cellData.value as DatasetRecord;
  const {human, needsReview, total} = dataset.counts;
  if (total === 0) {
    return (
      <Box justifyContent="center">
        <Text color="secondaryLight">—</Text>
      </Box>
    );
  }
  return (
    <Box gap={1} justifyContent="center" testID={`ai-datasets-source-${dataset.id}`}>
      <Text size="sm">{`${human} proofread · ${needsReview} to check`}</Text>
      <MeterBar fraction={human / total} />
    </Box>
  );
};

const AnswersCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const dataset = cellData.value as DatasetRecord;
  const judgments = dataset.judgments ?? [];
  if (judgments.length === 0) {
    return (
      <Box justifyContent="center">
        <Text color="secondaryLight">—</Text>
      </Box>
    );
  }
  const toCheck = answersToCheck(dataset);
  const allAnswered = judgments.every((entry) => entry.current >= entry.total);
  return (
    <Box alignItems="start" justifyContent="center">
      {toCheck > 0 ? (
        <Badge iconName="pen" secondary status="warning" value={`${toCheck} need proofreading`} />
      ) : allAnswered ? (
        <Badge iconName="check" secondary status="success" value="All answered" />
      ) : (
        <Badge
          secondary
          status="neutral"
          value={`${Math.min(...judgments.map((entry) => entry.current))} of ${dataset.counts.total} answered`}
        />
      )}
    </Box>
  );
};

export const AiDatasetsListView: React.FC<AiDatasetsListViewProps> = ({
  canImport = true,
  createError,
  createName,
  createOpen,
  createPromptBinding,
  datasets,
  importError,
  importFilename,
  importFormat,
  importOpen,
  importPaste,
  importPreview,
  importResult,
  isCreating,
  isImporting,
  isLoading,
  loadError,
  onCreate,
  onCreateNameChange,
  onCreatePromptBindingChange,
  onDismissCreate,
  onDismissImport,
  onFilePicked,
  onFileReadError,
  onGoToTraces,
  onImportPasteChange,
  onImportSubmit,
  onOpenDetail,
  onOpenImport,
  onRetry,
}) => {
  const customColumnComponentMap = useMemo(
    () => ({
      datasetAnswers: AnswersCell,
      datasetImport: ({cellData}: {cellData: DataTableCellData}) =>
        canImport ? (
          <Box alignItems="start" justifyContent="center">
            <Button
              iconName="file-import"
              onClick={() => {
                onOpenImport(String(cellData.value ?? ""));
              }}
              size="sm"
              testID={`ai-datasets-import-${String(cellData.value ?? "")}`}
              text="Import"
              variant="outline"
            />
          </Box>
        ) : null,
      datasetName: ({cellData}: {cellData: DataTableCellData}) => {
        const dataset = cellData.value as DatasetRecord;
        return (
          <Box
            accessibilityHint="Opens the dataset"
            accessibilityLabel={`Open dataset ${dataset.name}`}
            flex="grow"
            justifyContent="center"
            onClick={() => {
              onOpenDetail(dataset.id);
            }}
          >
            <Box testID={`ai-datasets-open-${dataset.id}`}>
              <Text bold numberOfLines={1}>
                {dataset.name}
              </Text>
            </Box>
          </Box>
        );
      },
      datasetSource: SourceCell,
      number: NumberCell,
    }),
    [canImport, onOpenDetail, onOpenImport]
  );

  const columns = useMemo(() => buildColumns(datasets), [datasets]);
  const {rows: _sortedDatasets, ...table} = useClientTable({
    columns,
    rows: datasets,
    searchText: datasetSearchText,
  });

  const handleFilesSelected = useCallback(
    (files: Array<{name: string; uri: string}>): void => {
      const file = files[0];
      if (!file) {
        return;
      }
      fetch(file.uri)
        .then((response) => response.text())
        .then((content) => {
          onFilePicked({content, filename: file.name});
        })
        .catch((error: unknown) => {
          console.warn("Could not read dataset import file", error);
          onFileReadError?.(FILE_READ_ERROR);
        });
    },
    [onFilePicked, onFileReadError]
  );

  const renderBody = (): React.ReactNode => {
    if (isLoading) {
      return (
        <Box alignItems="center" padding={5} testID="ai-datasets-loading">
          <Spinner />
        </Box>
      );
    }
    if (loadError) {
      return (
        <ObservabilityErrorState
          onRetry={onRetry}
          testID="ai-datasets-load-error"
          text={loadError}
        />
      );
    }
    if (datasets.length === 0) {
      return (
        <ObservabilityEmptyState
          actionIconName="arrow-right"
          actionText={onGoToTraces ? "Go to traces" : undefined}
          description="Pick traces and choose Add to dataset, or create an empty dataset and import JSON or CSV."
          iconName="database"
          onAction={onGoToTraces}
          testID="ai-datasets-empty"
          title="No datasets yet"
        />
      );
    }
    return (
      <DataTable
        {...table}
        customColumnComponentMap={customColumnComponentMap}
        emptyContent={
          <ObservabilityEmptyState
            description="Clear a filter or the search to see more datasets."
            iconName="filter"
            testID="ai-datasets-no-matches"
            title="No datasets match these filters"
          />
        }
        rowHeight={64}
        testID="ai-datasets-table"
      />
    );
  };

  return (
    <Box gap={4} testID="ai-datasets-list">
      {renderBody()}
      <Modal
        onDismiss={onDismissCreate}
        primaryButtonDisabled={isCreating}
        primaryButtonOnClick={onCreate}
        primaryButtonText="Create dataset"
        secondaryButtonOnClick={onDismissCreate}
        secondaryButtonText="Cancel"
        title="New dataset"
        visible={createOpen}
      >
        <Box gap={3} testID="ai-datasets-create-form">
          <TextField
            onChange={onCreateNameChange}
            testID="ai-datasets-create-name"
            title="Name"
            value={createName}
          />
          <TextField
            helperText="Optional. Items must match this prompt's input variables."
            onChange={onCreatePromptBindingChange}
            testID="ai-datasets-create-binding"
            title="Prompt"
            value={createPromptBinding}
          />
          {createError ? <Text color="error">{createError}</Text> : null}
        </Box>
      </Modal>
      <Modal
        onDismiss={onDismissImport}
        primaryButtonDisabled={isImporting}
        primaryButtonOnClick={onImportSubmit}
        primaryButtonText="Import"
        secondaryButtonOnClick={onDismissImport}
        secondaryButtonText="Cancel"
        title="Import items"
        visible={importOpen}
      >
        <Box gap={3} testID="ai-datasets-import-modal">
          <Box alignItems="center" direction="row" gap={2} wrap>
            <FilePickerButton
              onFilesSelected={handleFilesSelected}
              testID="ai-datasets-file-picker"
            />
            <Text color="secondaryLight" size="sm">
              Choose a .json or .csv file
            </Text>
          </Box>
          {importFilename ? (
            <Text testID="ai-datasets-import-filename">
              {importFilename} ({importFormat ?? detectImportFormat(importFilename, importPaste)})
            </Text>
          ) : null}
          {importPreview ? (
            <TextArea
              disabled
              onChange={() => undefined}
              rows={4}
              title="Preview"
              value={importPreview}
            />
          ) : null}
          <TextArea
            onChange={onImportPasteChange}
            rows={6}
            testID="ai-datasets-import-paste"
            title="Or paste JSON or CSV"
            value={importPaste}
          />
          {importResult ? (
            <Text color="success" testID="ai-datasets-import-result">
              {`Added ${importResult.created} ${importResult.created === 1 ? "item" : "items"}`}
              {importResult.errors.length > 0
                ? ` · ${importResult.errors.length} ${importResult.errors.length === 1 ? "row" : "rows"} with errors`
                : ""}
            </Text>
          ) : null}
          {importResult?.errors.map((entry) => {
            return (
              <Text color="error" key={`${entry.row}-${entry.path ?? ""}`} size="sm">
                Row {entry.row}
                {entry.path ? ` (${entry.path})` : ""}: {entry.message}
              </Text>
            );
          })}
          {importError ? (
            <Text color="error" testID="ai-datasets-import-error">
              {importError}
            </Text>
          ) : null}
        </Box>
      </Modal>
    </Box>
  );
};
