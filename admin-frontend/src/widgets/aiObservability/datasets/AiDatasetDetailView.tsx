import {Badge, Box, Button, SegmentedControl, Spinner, Text} from "@terreno/ui";
import React, {useMemo, useState} from "react";
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
  initialTab?: DatasetItemTab;
  isItemsLoading?: boolean;
  items: DatasetItemRecord[];
  itemsLoadError?: string;
  onCreateItem: () => void;
  onOpenExperiment: () => void;
  onOpenItem: (itemId: string) => void;
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

export const AiDatasetDetailView: React.FC<AiDatasetDetailViewProps> = ({
  canAddItem = true,
  canRunExperiment = true,
  dataset,
  initialTab = "all",
  isItemsLoading,
  items,
  itemsLoadError,
  onCreateItem,
  onOpenExperiment,
  onOpenItem,
  onRetryItems,
}) => {
  const [tab, setTab] = useState<DatasetItemTab>(initialTab);

  const filtered = useMemo(() => {
    return filterDatasetItemsByTab(items, tab);
  }, [items, tab]);

  const needsReviewCount = dataset.counts.needsReview;

  const rows: ObservabilityTableRow[] = useMemo(() => {
    return filtered.map((item) => {
      const attribution = item.annotatedBy?.label ?? (item.proofread ? "Human" : "Needs review");
      const traceId = item.sourceTraceId;
      return {
        accessibilityLabel: `Edit expected output for dataset item ${item.id}`,
        cells: [
          summarizeJson(item.input),
          summarizeJson(item.expectedOutput),
          `${item.origin} · ${attribution}`,
          traceId ? "Linked" : "—",
        ],
        key: item.id,
        onClick: () => {
          onOpenItem(item.id);
        },
      };
    });
  }, [filtered, onOpenItem]);

  const selectedIndex = TAB_OPTIONS.indexOf(tab);

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
              onClick={onCreateItem}
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
      <Text color="secondaryDark" size="sm" testID="ai-dataset-golden-guidance">
        Each item&apos;s expected output is its golden label: the answer this feature must give for
        that input. Experiments score the feature against proofread items only.
      </Text>
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
      {tab === "needsReview" ? (
        <Text color="secondaryDark" size="sm" testID="ai-dataset-review-guidance">
          Needs review items are not proofread yet. Open one, correct its expected output, tick
          Proofread, then Save and next to move down this list.
        </Text>
      ) : undefined}
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
          <Text color="secondaryDark">
            {tab === "needsReview"
              ? "Nothing needs review. Every item is proofread."
              : "No items in this tab."}
          </Text>
        </Box>
      ) : (
        <Box gap={2}>
          <Text color="secondaryDark" size="sm">
            Select an item to edit its expected output.
          </Text>
          <ObservabilityTable columns={COLUMNS} rows={rows} testID="ai-dataset-items-table" />
        </Box>
      )}
    </Box>
  );
};
