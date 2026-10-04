import {
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  FilePickerButton,
  Modal,
  Text,
  TextArea,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useMemo} from "react";
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

const COLUMNS: DataTableColumn[] = [
  {columnType: "text", title: "Name", width: 180},
  {columnType: "text", title: "Items", width: 80},
  {columnType: "text", title: "Provenance", width: 160},
  {columnType: "text", title: "Schema binding", width: 160},
  {columnType: "text", title: "Updated", width: 120},
  {columnType: "datasetOpen", title: "", width: 88},
  {columnType: "datasetImport", title: "", width: 100},
];

const formatUpdated = (iso: string): string => {
  const parsed = DateTime.fromISO(iso);
  if (!parsed.isValid) {
    return iso;
  }
  return parsed.toRelative() ?? iso;
};

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

  const rows: DataTableCellData[][] = useMemo(() => {
    return datasets.map((dataset) => {
      return [
        {value: dataset.name},
        {value: String(dataset.counts.total)},
        {value: formatProvenanceBar(dataset.counts)},
        {value: dataset.inputSchemaPromptName ?? "—"},
        {value: formatUpdated(dataset.updated)},
        {value: dataset.id},
        {value: dataset.id},
      ];
    });
  }, [datasets]);

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
          columns={COLUMNS}
          customColumnComponentMap={customColumnComponentMap}
          data={rows}
          testID="ai-datasets-table"
        />
      )}
      <Modal onDismiss={onDismissCreate} title="New dataset" visible={createOpen}>
        <Box gap={3} padding={3} testID="ai-datasets-create-form">
          <TextField onChange={onCreateNameChange} title="Name" value={createName} />
          <TextField
            helperText="Optional prompt whose input schema validates items"
            onChange={onCreatePromptBindingChange}
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
