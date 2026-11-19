import {Box, Spinner, Text} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {observabilityActionAllowed} from "../shell/observabilityPermissions";
import {AiDatasetItemView} from "./AiDatasetItemView";
import {nextNeedsReviewItemId, unwrapDatasetItems, unwrapDatasetRecord} from "./datasetTypes";
import {emptyLike, type JsonSchema, prepareFormValue} from "./expectedOutputModel";
import {useAiObservabilityDatasetsApi} from "./useAiObservabilityDatasetsApi";

const firstParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

type OutcomeClass = "fn" | "fp" | "tn" | "tp";

const outcomeOrNull = (value: string): OutcomeClass | null => {
  if (value === "tp" || value === "fp" || value === "tn" || value === "fn") {
    return value;
  }
  return null;
};

const saveErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "data" in error) {
    const title = (error as {data?: {title?: string}}).data?.title;
    if (title) {
      return title;
    }
  }
  return "Could not save this dataset item.";
};

export const AiDatasetItemScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {routeBase} = props;
  const params = useLocalSearchParams<{
    datasetId?: string | string[];
    itemId?: string | string[];
  }>();
  const datasetId = firstParam(params.datasetId);
  const itemId = firstParam(params.itemId);
  const isNew = itemId.length === 0;
  const {useCreateItemMutation, useDetailQuery, useItemsQuery, useUpdateItemMutation} =
    useAiObservabilityDatasetsApi();
  const {useStatusQuery} = useAiObservabilityPromptsApi();
  const statusQuery = useStatusQuery();
  const canSave = observabilityActionAllowed({
    action: "update",
    resource: "aiDataset",
    status: unwrapObservabilityStatus(statusQuery.data),
    statusError: statusQuery.isError,
    statusLoading: statusQuery.isLoading,
  });
  const {data, isError, isLoading} = useDetailQuery(datasetId, {skip: datasetId.length === 0});
  const {data: itemsRaw, isLoading: isItemsLoading} = useItemsQuery(datasetId, {
    skip: datasetId.length === 0,
  });
  const [createItem] = useCreateItemMutation();
  const [updateItem] = useUpdateItemMutation();
  const dataset = useMemo(() => unwrapDatasetRecord(data), [data]);
  const items = useMemo(() => unwrapDatasetItems(itemsRaw), [itemsRaw]);
  const item = useMemo(() => items.find((entry) => entry.id === itemId), [itemId, items]);
  const schema = dataset?.expectedOutputSchema as JsonSchema | undefined;
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-dataset-detail?id=${encodeURIComponent(datasetId)}`;
  const reviewQueueHref = `${backHref}&tab=needsReview`;
  const reviewing = !isNew && item !== undefined && !item.proofread;
  const nextReviewItem = reviewing ? nextNeedsReviewItemId(items, itemId) : undefined;

  const formKey = `${datasetId}:${itemId}`;
  const [filledKey, setFilledKey] = useState<string | undefined>(undefined);
  const formReady = filledKey === formKey;
  const [expected, setExpected] = useState<unknown>("");
  const [input, setInput] = useState<unknown>("");
  const [outcomeClass, setOutcomeClass] = useState("");
  const [proofread, setProofread] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  // Fill the form once per dataset and item, after both have loaded, so a param change refills it.
  useEffect(() => {
    if (formReady || isLoading || isItemsLoading) {
      return;
    }
    setError("");
    setIsSaving(false);
    if (!dataset) {
      setFilledKey(formKey);
      return;
    }
    if (isNew) {
      const sample = items[0];
      setInput(sample ? emptyLike(sample.input) : "");
      setExpected(
        schema
          ? prepareFormValue(schema, undefined)
          : sample && sample.expectedOutput !== undefined
            ? emptyLike(sample.expectedOutput)
            : ""
      );
      setOutcomeClass("");
      setProofread(true);
      setFilledKey(formKey);
      return;
    }
    if (!item) {
      setFilledKey(formKey);
      return;
    }
    setInput(item.input);
    setExpected(prepareFormValue(schema, item.expectedOutput));
    setOutcomeClass(item.outcomeClass ?? "");
    setProofread(item.proofread);
    setFilledKey(formKey);
  }, [dataset, formKey, formReady, isItemsLoading, isLoading, isNew, item, items, schema]);

  const handleOpenTrace = useCallback((): void => {
    if (!item?.sourceTraceId) {
      return;
    }
    router.push(`${prefix}/ai-trace-detail?id=${encodeURIComponent(item.sourceTraceId)}`);
  }, [item?.sourceTraceId, prefix]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!datasetId) {
      return;
    }
    setError("");
    setIsSaving(true);
    const outcome = outcomeOrNull(outcomeClass);
    try {
      if (isNew) {
        await createItem({
          body: {
            expectedOutput: expected,
            input,
            origin: "manual",
            outcomeClass: outcome,
            proofread,
          },
          datasetId,
        }).unwrap();
      } else {
        await updateItem({
          body: {
            expectedOutput: expected,
            outcomeClass: outcome,
            proofread,
          },
          datasetId,
          itemId,
        }).unwrap();
      }
      if (isNew) {
        router.push(backHref);
      } else if (reviewing && nextReviewItem) {
        router.replace(
          `${prefix}/ai-dataset-item?datasetId=${encodeURIComponent(datasetId)}&itemId=${encodeURIComponent(nextReviewItem)}`
        );
      } else if (reviewing) {
        router.push(reviewQueueHref);
      } else {
        router.push(backHref);
      }
    } catch (saveError) {
      setError(saveErrorMessage(saveError));
      setIsSaving(false);
    }
  }, [
    backHref,
    createItem,
    datasetId,
    expected,
    input,
    isNew,
    itemId,
    nextReviewItem,
    outcomeClass,
    prefix,
    proofread,
    reviewQueueHref,
    reviewing,
    updateItem,
  ]);

  let saveLabel = "Save expected output";
  if (isNew) {
    saveLabel = "Add item";
  } else if (reviewing) {
    saveLabel = nextReviewItem ? "Save and next" : "Save and finish review";
  }

  if (datasetId.length === 0) {
    return (
      <AiObservabilityChrome {...props} backHref={prefix} screenName="ai-dataset-item">
        <Box padding={4}>
          <Text>Missing dataset id.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isLoading || isItemsLoading || !formReady) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} hideHeader screenName="ai-dataset-item">
        <Box alignItems="center" padding={4} testID="ai-dataset-item-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isError || !dataset || (!isNew && !item)) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-dataset-item">
        <Box padding={4}>
          <Text color="error">
            {dataset ? "Failed to load dataset item." : "Failed to load dataset."}
          </Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  return (
    <AiObservabilityChrome
      {...props}
      backHref={backHref}
      description={
        isNew
          ? `Add a golden row to ${dataset.name}.`
          : `Set the golden expected output for ${dataset.name}.`
      }
      screenName="ai-dataset-item"
      title={isNew ? "New dataset item" : "Edit expected output"}
    >
      <AiDatasetItemView
        canSave={canSave}
        error={error}
        expected={expected}
        expectedSchema={schema}
        input={input}
        inputEditable={isNew}
        isSaving={isSaving}
        onExpectedChange={setExpected}
        onInputChange={setInput}
        onOpenTrace={!isNew && item?.sourceTraceId ? handleOpenTrace : undefined}
        onOutcomeChange={setOutcomeClass}
        onProofreadChange={setProofread}
        onSave={handleSave}
        outcomeClass={outcomeClass}
        proofread={proofread}
        reviewing={reviewing}
        saveLabel={saveLabel}
      />
    </AiObservabilityChrome>
  );
};
