import {Button} from "@terreno/ui";
import {router} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {observabilityActionAllowed} from "../shell/observabilityPermissions";
import {AiDatasetsListView} from "./AiDatasetsListView";
import {buildCsvImportPayload, detectImportFormat, parseImportText} from "./datasetImport";
import {type DatasetImportResult, unwrapDatasetList} from "./datasetTypes";
import {useAiObservabilityDatasetsApi} from "./useAiObservabilityDatasetsApi";

const DATASETS_DESCRIPTION =
  "Fixed sets of inputs to test prompts and judges on. Build one from traces, then have people answer it once.";

export const AiDatasetsScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useCreateMutation, useImportMutation, useListQuery} = useAiObservabilityDatasetsApi(api);
  const {useStatusQuery} = useAiObservabilityPromptsApi(api);
  const {data, isError, isLoading, refetch} = useListQuery();
  const statusQuery = useStatusQuery();
  const canCreate = observabilityActionAllowed({
    action: "create",
    resource: "aiDataset",
    status: unwrapObservabilityStatus(statusQuery.data),
    statusError: statusQuery.isError,
    statusLoading: statusQuery.isLoading,
  });
  const canImport = observabilityActionAllowed({
    action: "update",
    resource: "aiDataset",
    status: unwrapObservabilityStatus(statusQuery.data),
    statusError: statusQuery.isError,
    statusLoading: statusQuery.isLoading,
  });
  const [createDataset, createState] = useCreateMutation();
  const [importItems, importState] = useImportMutation();
  const datasets = useMemo(() => unwrapDatasetList(data), [data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPromptBinding, setCreatePromptBinding] = useState("");
  const [createError, setCreateError] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importDatasetId, setImportDatasetId] = useState("");
  const [importPaste, setImportPaste] = useState("");
  const [importFilename, setImportFilename] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "json" | undefined>(undefined);
  const [importPreview, setImportPreview] = useState("");
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<DatasetImportResult | undefined>(undefined);

  const handleOpenDetail = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-dataset-detail?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    setCreateError("");
    if (!createName.trim()) {
      setCreateError("Name is required.");
      return;
    }
    try {
      const created = await createDataset({
        inputSchemaPromptName: createPromptBinding.trim() || undefined,
        name: createName.trim(),
      }).unwrap();
      setCreateOpen(false);
      router.push(`${prefix}/ai-dataset-detail?id=${encodeURIComponent(created.id)}`);
    } catch {
      setCreateError("Could not create dataset.");
    }
  }, [createDataset, createName, createPromptBinding, prefix]);

  const handleOpenImport = useCallback((datasetId: string): void => {
    setImportDatasetId(datasetId);
    setImportPaste("");
    setImportFilename("");
    setImportFormat(undefined);
    setImportPreview("");
    setImportError("");
    setImportResult(undefined);
    setImportOpen(true);
  }, []);

  const handleFilePicked = useCallback(
    ({content, filename}: {content: string; filename: string}): void => {
      const format = detectImportFormat(filename, content);
      setImportFilename(filename);
      setImportFormat(format);
      setImportPaste(content);
      setImportPreview(content.slice(0, 400));
      setImportError("");
    },
    []
  );

  const handleImportSubmit = useCallback(async (): Promise<void> => {
    if (!importDatasetId || !importPaste.trim()) {
      setImportError("Choose a file or paste import content.");
      return;
    }
    setImportError("");
    try {
      const format = importFormat ?? detectImportFormat(importFilename || "paste.txt", importPaste);
      const payload =
        format === "csv"
          ? buildCsvImportPayload(importPaste)
          : parseImportText(importPaste, "json");
      const result = await importItems({
        body: payload.body,
        datasetId: importDatasetId,
      }).unwrap();
      setImportResult(result);
      refetch();
    } catch (error) {
      const title =
        error && typeof error === "object" && "data" in error
          ? (error as {data?: {title?: string}}).data?.title
          : undefined;
      setImportError(title ?? "Could not import these items.");
    }
  }, [importDatasetId, importFilename, importFormat, importItems, importPaste, refetch]);

  const handleOpenCreate = useCallback((): void => {
    setCreateError("");
    setCreateOpen(true);
  }, []);

  const handleDismissCreate = useCallback((): void => {
    setCreateOpen(false);
  }, []);

  const handleDismissImport = useCallback((): void => {
    setImportOpen(false);
  }, []);

  const handleGoToTraces = useCallback((): void => {
    router.push(`${prefix}/ai-traces`);
  }, [prefix]);

  const loadError = isError ? "Could not load datasets." : undefined;

  return (
    <AiObservabilityChrome
      {...props}
      actions={
        canCreate ? (
          <Button
            iconName="plus"
            onClick={handleOpenCreate}
            testID="ai-datasets-create"
            text="New dataset"
            variant="primary"
          />
        ) : undefined
      }
      description={DATASETS_DESCRIPTION}
      screenName="ai-datasets"
    >
      <AiDatasetsListView
        canImport={canImport}
        createError={createError}
        createName={createName}
        createOpen={createOpen}
        createPromptBinding={createPromptBinding}
        datasets={datasets}
        importDatasetId={importDatasetId}
        importError={importError}
        importFilename={importFilename}
        importFormat={importFormat}
        importOpen={importOpen}
        importPaste={importPaste}
        importPreview={importPreview}
        importResult={importResult}
        isCreating={createState.isLoading}
        isImporting={importState.isLoading}
        isLoading={isLoading}
        loadError={loadError}
        onCreate={handleCreate}
        onCreateNameChange={setCreateName}
        onCreatePromptBindingChange={setCreatePromptBinding}
        onDismissCreate={handleDismissCreate}
        onDismissImport={handleDismissImport}
        onFilePicked={handleFilePicked}
        onFileReadError={setImportError}
        onGoToTraces={handleGoToTraces}
        onImportPasteChange={setImportPaste}
        onImportSubmit={handleImportSubmit}
        onOpenDetail={handleOpenDetail}
        onOpenImport={handleOpenImport}
        onRetry={refetch}
      />
    </AiObservabilityChrome>
  );
};
