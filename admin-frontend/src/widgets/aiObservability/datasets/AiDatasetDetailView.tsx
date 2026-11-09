import {
  Badge,
  Box,
  Button,
  Heading,
  Modal,
  SegmentedControl,
  Spinner,
  Text,
  TextArea,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useMemo, useState} from "react";
import {
  ObservabilityTable,
  type ObservabilityTableColumn,
  type ObservabilityTableRow,
} from "../shell/ObservabilityTable";
import {
  type DatasetItemRecord,
  type DatasetItemTab,
  type DatasetRecord,
  filterDatasetItemsByTab,
  summarizeJson,
} from "./datasetTypes";

export interface AiDatasetDetailViewProps {
  canAddItem?: boolean;
  canRunExperiment?: boolean;
  dataset: DatasetRecord;
  isItemsLoading?: boolean;
  items: DatasetItemRecord[];
  itemsLoadError?: string;
  onAddItem: (body: {expectedOutput: string; input: string}) => Promise<string | undefined>;
  onOpenExperiment: () => void;
  onOpenTrace?: (traceId: string) => void;
  onRetryItems?: () => void;
  routeBase: string;
}

const TAB_OPTIONS: DatasetItemTab[] = ["all", "human", "auto", "needsReview"];

const tabLabel = (tab: DatasetItemTab, needsReviewCount: number): string => {
  if (tab === "all") {
    return "All";
  }
  if (tab === "human") {
    return "Human";
  }
  if (tab === "auto") {
    return "Auto";
  }
  if (needsReviewCount > 0) {
    return `Needs review (${needsReviewCount})`;
  }
  return "Needs review";
};

const COLUMNS: ObservabilityTableColumn[] = [
  {grow: 2.5, minWidth: 220, title: "Input"},
  {grow: 2.5, minWidth: 220, title: "Expected"},
  {minWidth: 140, title: "Provenance"},
  {grow: 0.7, minWidth: 90, title: "Trace"},
];

const formatFullJson = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatTimestamp = (value: string): string => {
  const timestamp = DateTime.fromISO(value);
  if (!timestamp.isValid) {
    return value;
  }
  return timestamp.toLocal().toLocaleString(DateTime.DATETIME_MED);
};

export const AiDatasetDetailView: React.FC<AiDatasetDetailViewProps> = ({
  canAddItem = true,
  canRunExperiment = true,
  dataset,
  isItemsLoading,
  items,
  itemsLoadError,
  onAddItem,
  onOpenExperiment,
  onOpenTrace,
  onRetryItems,
}) => {
  const [tab, setTab] = useState<DatasetItemTab>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [inputText, setInputText] = useState("{}");
  const [expectedText, setExpectedText] = useState("{}");
  const [selectedItem, setSelectedItem] = useState<DatasetItemRecord | undefined>();

  const filtered = useMemo(() => {
    return filterDatasetItemsByTab(items, tab);
  }, [items, tab]);

  const needsReviewCount = dataset.counts.needsReview;

  const rows: ObservabilityTableRow[] = useMemo(() => {
    return filtered.map((item) => {
      const attribution = item.annotatedBy?.label ?? (item.proofread ? "Human" : "Needs review");
      const traceId = item.sourceTraceId;
      return {
        accessibilityLabel: `Open dataset item ${item.id}`,
        cells: [
          summarizeJson(item.input),
          summarizeJson(item.expectedOutput),
          `${item.origin} · ${attribution}`,
          traceId ? "Linked" : "—",
        ],
        key: item.id,
        onClick: () => {
          setSelectedItem(item);
        },
      };
    });
  }, [filtered]);

  const selectedIndex = TAB_OPTIONS.indexOf(tab);
  const handleAddItem = useCallback(async (): Promise<void> => {
    setAddError("");
    setIsAdding(true);
    const error = await onAddItem({expectedOutput: expectedText, input: inputText});
    setIsAdding(false);
    if (error) {
      setAddError(error);
      return;
    }
    setAddOpen(false);
  }, [expectedText, inputText, onAddItem]);

  const handleDismissItem = useCallback((): void => {
    setSelectedItem(undefined);
  }, []);

  const handleOpenSelectedTrace = useCallback((): void => {
    if (!selectedItem?.sourceTraceId || !onOpenTrace) {
      return;
    }
    const traceId = selectedItem.sourceTraceId;
    setSelectedItem(undefined);
    onOpenTrace(traceId);
  }, [onOpenTrace, selectedItem]);

  return (
    <Box gap={4} testID="ai-dataset-detail">
      <Box direction="row" gap={2} justifyContent="between" wrap>
        <Box gap={1}>
          <Text>
            {dataset.counts.human} human · {dataset.counts.auto} auto · {dataset.counts.total} total
          </Text>
          <Text color="secondaryDark" size="sm">
            Input schema binding: {dataset.inputSchemaPromptName ?? "none"}
          </Text>
        </Box>
        <Box direction="row" gap={2}>
          {canAddItem ? (
            <Button
              onClick={() => {
                setAddError("");
                setAddOpen(true);
              }}
              testID="ai-dataset-add-item"
              text="Add item"
              variant="secondary"
            />
          ) : undefined}
          {canRunExperiment ? (
            <Button
              onClick={onOpenExperiment}
              testID="ai-dataset-run-experiment"
              text="Run experiment"
            />
          ) : undefined}
        </Box>
      </Box>
      <SegmentedControl
        items={TAB_OPTIONS.map((option) => tabLabel(option, needsReviewCount))}
        onChange={(index) => {
          const next = TAB_OPTIONS[index];
          if (next) {
            setTab(next);
          }
        }}
        selectedIndex={selectedIndex}
        testID="ai-dataset-tabs"
      />
      {tab === "needsReview" && needsReviewCount > 0 ? (
        <Badge
          status="error"
          testID="ai-dataset-needs-review-count"
          value={`${needsReviewCount} need review`}
        />
      ) : undefined}
      {isItemsLoading ? (
        <Box alignItems="center" padding={4} testID="ai-dataset-items-loading">
          <Spinner />
        </Box>
      ) : itemsLoadError ? (
        <Box gap={2} padding={4} testID="ai-dataset-items-error">
          <Text color="error">{itemsLoadError}</Text>
          {onRetryItems ? <Button onClick={onRetryItems} text="Retry" variant="secondary" /> : null}
        </Box>
      ) : filtered.length === 0 ? (
        <Box padding={4} testID="ai-dataset-items-empty">
          <Text color="secondaryDark">No items in this tab.</Text>
        </Box>
      ) : (
        <Box gap={2}>
          <Text color="secondaryDark" size="sm">
            Select an item to view its complete input, expected output, and metadata.
          </Text>
          <ObservabilityTable columns={COLUMNS} rows={rows} testID="ai-dataset-items-table" />
        </Box>
      )}
      <Modal
        onDismiss={handleDismissItem}
        title="Dataset item details"
        visible={Boolean(selectedItem)}
      >
        {selectedItem ? (
          <Box gap={3} maxHeight={600} padding={3} scroll testID="ai-dataset-item-modal">
            <Box gap={1}>
              <Heading size="sm">Input</Heading>
              <Box color="baseAlternate" padding={3} rounding="md">
                <Text>{formatFullJson(selectedItem.input)}</Text>
              </Box>
            </Box>
            <Box gap={1}>
              <Heading size="sm">Expected output</Heading>
              <Box color="baseAlternate" padding={3} rounding="md">
                <Text>{formatFullJson(selectedItem.expectedOutput)}</Text>
              </Box>
            </Box>
            <Box gap={1}>
              <Heading size="sm">Item details</Heading>
              <Text>ID: {selectedItem.id}</Text>
              <Text>Dataset ID: {selectedItem.datasetId}</Text>
              <Text>Origin: {selectedItem.origin}</Text>
              <Text>Proofread: {selectedItem.proofread ? "Yes" : "No"}</Text>
              <Text>Outcome: {selectedItem.outcomeClass ?? "—"}</Text>
              <Text>Source trace: {selectedItem.sourceTraceId ?? "—"}</Text>
              <Text>Annotated by: {selectedItem.annotatedBy?.label ?? "—"}</Text>
              <Text>Annotator user: {selectedItem.annotatedBy?.userId ?? "—"}</Text>
              <Text>Review item: {selectedItem.annotatedBy?.reviewItemId ?? "—"}</Text>
              <Text>Tags: {selectedItem.tags.join(", ") || "—"}</Text>
              <Text>Created: {formatTimestamp(selectedItem.created)}</Text>
              <Text>Updated: {formatTimestamp(selectedItem.updated)}</Text>
            </Box>
            <Box gap={1}>
              <Heading size="sm">Metadata</Heading>
              <Box color="baseAlternate" padding={3} rounding="md">
                <Text>{formatFullJson(selectedItem.metadata)}</Text>
              </Box>
            </Box>
            {selectedItem.sourceTraceId && onOpenTrace ? (
              <Button
                onClick={handleOpenSelectedTrace}
                testID="ai-dataset-item-open-trace"
                text="Open source trace"
                variant="secondary"
              />
            ) : undefined}
          </Box>
        ) : undefined}
      </Modal>
      <Modal
        onDismiss={() => {
          setAddOpen(false);
        }}
        title="Add dataset item"
        visible={addOpen}
      >
        <Box gap={3} padding={3}>
          <TextArea onChange={setInputText} rows={4} title="Input (JSON)" value={inputText} />
          <TextArea
            onChange={setExpectedText}
            rows={4}
            title="Expected output (JSON)"
            value={expectedText}
          />
          <Button loading={isAdding} onClick={handleAddItem} text="Add item" />
          {addError ? (
            <Text color="error" testID="ai-dataset-add-item-error">
              {addError}
            </Text>
          ) : undefined}
        </Box>
      </Modal>
    </Box>
  );
};
