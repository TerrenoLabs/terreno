import {
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  FilePickerButton,
  Modal,
  Text,
  TextArea,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {detectImportFormat} from "./datasetImport";
import {type DatasetImportResult, type DatasetRecord, formatProvenanceBar} from "./datasetTypes";

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
  onImportPasteChange: (value: string) => void;
  onImportSubmit: () => void;
  onOpenCreate: () => void;
  onOpenDetail: (id: string) => void;
  onOpenImport: (datasetId: string) => void;
  onRetry: () => void;
}

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

const datasetSearchText = (dataset: DatasetRecord): string => dataset.name;

const buildColumns = (datasets: DatasetRecord[]): ClientTableColumn<DatasetRecord>[] => [
  {
    filter: {kind: "text"},
    key: "name",
    title: "Name",
    value: (dataset) => dataset.name,
    width: 240,
  },
  {
    cell: (dataset) => ({value: String(dataset.counts.total)}),
    filter: {kind: "numberRange"},
    key: "items",
    title: "Items",
    value: (dataset) => dataset.counts.total,
    width: 120,
  },
  {
    // Sorts and filters by the human-annotated share shown first in the cell.
    cell: (dataset) => ({value: formatProvenanceBar(dataset.counts)}),
    filter: {kind: "numberRange", label: "Human %"},
    key: "provenance",
    title: "Provenance",
    value: humanShare,
    width: 200,
  },
  {
    cell: (dataset) => ({value: dataset.inputSchemaPromptName ?? "—"}),
    filter: {
      kind: "choice",
      options: distinctChoiceOptions(datasets, (dataset) => dataset.inputSchemaPromptName),
    },
    key: "schemaBinding",
    title: "Schema binding",
    value: (dataset) => dataset.inputSchemaPromptName,
    width: 220,
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
    columnType: "datasetOpen",
    key: "open",
    title: "",
    width: 88,
  },
  {
    cell: (dataset) => ({value: dataset.id}),
    columnType: "datasetImport",
    key: "import",
    title: "",
    width: 100,
  },
];

export const AiDatasetsListView: React.FC<AiDatasetsListViewProps> = ({
  canCreate = true,
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
  onImportPasteChange,
  onImportSubmit,
  onOpenCreate,
  onOpenDetail,
  onOpenImport,
  onRetry,
}) => {
  const customColumnComponentMap = useMemo(
    () => ({
      datasetImport: ({cellData}: {cellData: DataTableCellData}) =>
        canImport ? (
          <Box justifyContent="center">
            <Button
              onClick={() => {
                onOpenImport(String(cellData.value ?? ""));
              }}
              size="sm"
              testID={`ai-datasets-import-${String(cellData.value ?? "")}`}
              text="Import"
              variant="ghost"
            />
          </Box>
        ) : null,
      datasetOpen: ({cellData}: {cellData: DataTableCellData}) => (
        <Box justifyContent="center">
          <Button
            onClick={() => {
              onOpenDetail(String(cellData.value ?? ""));
            }}
            size="sm"
            testID={`ai-datasets-open-${String(cellData.value ?? "")}`}
            text="Open"
            variant="outline"
          />
        </Box>
      ),
    }),
    [canImport, onOpenDetail, onOpenImport]
  );

  const columns = useMemo(() => buildColumns(datasets), [datasets]);
  const {rows: _sortedDatasets, ...table} = useClientTable({
    columns,
    rows: datasets,
    searchText: datasetSearchText,
  });

  return (
    <Box gap={3} testID="ai-datasets-list">
      <Box direction="row" gap={2} justifyContent="between" wrap>
        <Text color="secondaryDark" size="sm">
          Human-annotated items are proofread. Auto-captured items may need review.
        </Text>
        {canCreate ? (
          <Button onClick={onOpenCreate} testID="ai-datasets-create" text="New dataset" />
        ) : undefined}
      </Box>
      {loadError ? (
        <Box gap={2} testID="ai-datasets-load-error">
          <Text color="error">{loadError}</Text>
          <Button onClick={onRetry} text="Retry" variant="secondary" />
        </Box>
      ) : undefined}
      {isLoading ? (
        <Box padding={4} testID="ai-datasets-loading">
          <Text>Loading datasets…</Text>
        </Box>
      ) : datasets.length === 0 ? (
        <Box padding={4} testID="ai-datasets-empty">
          <Text color="secondaryDark">No datasets yet. Create one or import JSON/CSV.</Text>
        </Box>
      ) : (
        <DataTable
          {...table}
          customColumnComponentMap={customColumnComponentMap}
          emptyContent={
            <Box padding={4} testID="ai-datasets-no-matches">
              <Text color="secondaryDark">No datasets match these filters.</Text>
            </Box>
          }
          testID="ai-datasets-table"
        />
      )}
      <Modal onDismiss={onDismissCreate} title="New dataset" visible={createOpen}>
        <Box gap={3} padding={3} testID="ai-datasets-create-form">
          <TextField
            onChange={onCreateNameChange}
            testID="ai-datasets-create-name"
            title="Name"
            value={createName}
          />
          <TextField
            helperText="Optional prompt whose input schema validates items"
            onChange={onCreatePromptBindingChange}
            testID="ai-datasets-create-binding"
            title="Input schema prompt binding"
            value={createPromptBinding}
          />
          {createError ? <Text color="error">{createError}</Text> : undefined}
          <Button loading={isCreating} onClick={onCreate} text="Create dataset" />
        </Box>
      </Modal>
      <Modal onDismiss={onDismissImport} title="Import items" visible={importOpen}>
        <Box gap={3} padding={3} testID="ai-datasets-import-modal">
          <Box direction="row" gap={2}>
            <FilePickerButton
              onFilesSelected={(files) => {
                const file = files[0];
                if (!file) {
                  return;
                }
                fetch(file.uri)
                  .then((response) => response.text())
                  .then((content) => {
                    onFilePicked({content, filename: file.name});
                  })
                  .catch(() => undefined);
              }}
              testID="ai-datasets-file-picker"
            />
            <Text color="secondaryDark" size="sm">
              Select .json or .csv
            </Text>
          </Box>
          {importFilename ? (
            <Text testID="ai-datasets-import-filename">
              {importFilename} ({importFormat ?? detectImportFormat(importFilename, importPaste)})
            </Text>
          ) : undefined}
          {importPreview ? (
            <TextArea
              disabled
              onChange={() => undefined}
              rows={4}
              title="Preview"
              value={importPreview}
            />
          ) : undefined}
          <TextArea
            onChange={onImportPasteChange}
            rows={6}
            testID="ai-datasets-import-paste"
            title="Or paste JSON / CSV"
            value={importPaste}
          />
          {importResult ? (
            <Text color="success" testID="ai-datasets-import-result">
              Created {importResult.created} items
              {importResult.errors.length > 0 ? ` · ${importResult.errors.length} row errors` : ""}
            </Text>
          ) : undefined}
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
          ) : undefined}
          <Button loading={isImporting} onClick={onImportSubmit} text="Import" />
        </Box>
      </Modal>
    </Box>
  );
};
