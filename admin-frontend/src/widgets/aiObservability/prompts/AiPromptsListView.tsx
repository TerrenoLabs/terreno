import {
  Badge,
  Box,
  DataTable,
  type DataTableCellData,
  Modal,
  SegmentedControl,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {ALL_FOLDERS, filterPrompts, folderCounts, type PromptListItem} from "./promptTypes";

/** List rows can carry a description and labels when the backend sends them. */
type PromptListRow = PromptListItem & {
  description?: string;
  labels?: Array<{label: string; version: number}>;
};

const PROMPT_TYPE_LABELS: Record<PromptListItem["type"], string> = {
  chat: "Chat",
  text: "Text",
};

/** Two-line Prompt cells need more than the default 54px row. */
const PROMPT_ROW_HEIGHT = 72;

const productionVersion = (prompt: PromptListItem): number | undefined => {
  return prompt.production === "—" ? undefined : prompt.production;
};

const isNewestStaging = (prompt: PromptListRow): boolean => {
  return Boolean(
    prompt.labels?.some(
      (entry) => entry.label === "staging" && entry.version === prompt.latestVersion
    )
  );
};

/** Relative time of the last call in the past 7 days, e.g. "2 hours ago". */
const formatPromptLastUsed = (iso?: string): string => {
  if (!iso) {
    return "—";
  }
  const parsed = DateTime.fromISO(iso);
  if (!parsed.isValid) {
    return "—";
  }
  return parsed.toRelative() ?? "—";
};

const promptSubline = (prompt: PromptListRow): string => {
  return prompt.description ? `${prompt.folder} · ${prompt.description}` : prompt.folder;
};

const buildColumns = (prompts: PromptListRow[]): ClientTableColumn<PromptListRow>[] => [
  {
    cell: (prompt) => ({value: prompt}),
    columnType: "promptName",
    filter: {kind: "text"},
    key: "name",
    title: "Prompt",
    value: (prompt) => prompt.name,
    width: 320,
  },
  {
    cell: (prompt) => ({value: prompt.type}),
    columnType: "promptType",
    filter: {
      kind: "choice",
      options: distinctChoiceOptions(prompts, (prompt) => prompt.type).map((option) => ({
        label: PROMPT_TYPE_LABELS[option.value as PromptListItem["type"]] ?? option.value,
        value: option.value,
      })),
    },
    key: "type",
    title: "Type",
    value: (prompt) => prompt.type,
    width: 120,
  },
  {
    cell: (prompt) => ({value: productionVersion(prompt)}),
    columnType: "promptProduction",
    filter: {
      kind: "choice",
      options: distinctChoiceOptions(prompts, productionVersion).map((option) => ({
        label: `v${option.value}`,
        value: option.value,
      })),
    },
    key: "production",
    title: "Production",
    value: productionVersion,
    width: 160,
  },
  {
    cell: (prompt) => ({value: prompt}),
    columnType: "promptNewest",
    filter: {kind: "numberRange"},
    key: "newest",
    title: "Newest",
    value: (prompt) => prompt.latestVersion,
    width: 170,
  },
  {
    cell: (prompt) => ({
      value: prompt.usage7d ? prompt.usage7d.calls.toLocaleString("en-US") : "—",
    }),
    columnType: "number",
    filter: {kind: "numberRange"},
    key: "calls7d",
    title: "Calls 7 days",
    value: (prompt) => prompt.usage7d?.calls,
    width: 160,
  },
  {
    cell: (prompt) => ({value: formatPromptLastUsed(prompt.usage7d?.lastUsed)}),
    filter: {kind: "dateRange"},
    key: "lastUsed",
    title: "Last used",
    value: (prompt) => prompt.usage7d?.lastUsed,
    width: 170,
  },
];

const TypeBadgeCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const type = String(cellData.value ?? "") as PromptListItem["type"];
  return (
    <Box alignItems="start" justifyContent="center">
      <Badge
        iconName={type === "chat" ? "comments" : "align-left"}
        secondary
        status="neutral"
        value={PROMPT_TYPE_LABELS[type] ?? type}
      />
    </Box>
  );
};

const ProductionCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  if (typeof cellData.value !== "number") {
    return (
      <Box justifyContent="center">
        <Text color="secondaryLight">—</Text>
      </Box>
    );
  }
  return (
    <Box alignItems="start" justifyContent="center">
      <Badge secondary status="success" value={`v${cellData.value}`} />
    </Box>
  );
};

const NewestCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const prompt = cellData.value as PromptListRow;
  return (
    <Box alignItems="center" direction="row" gap={2}>
      <Text>{`v${prompt.latestVersion}`}</Text>
      {isNewestStaging(prompt) ? <Badge secondary status="info" value="Staging" /> : null}
    </Box>
  );
};

const NumberCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box flex="grow" justifyContent="center" width="100%">
    <Text align="right">{String(cellData.value ?? "")}</Text>
  </Box>
);

export interface AiPromptsListViewProps {
  canCreate?: boolean;
  createDescription: string;
  createError?: string;
  createFolder: string;
  createName: string;
  createOpen: boolean;
  createSystem: string;
  createTemplate: string;
  folder: string;
  isCreating?: boolean;
  isLoading?: boolean;
  loadError?: string;
  onCreate: () => void;
  onCreateDescriptionChange: (value: string) => void;
  onCreateFolderChange: (value: string) => void;
  onCreateNameChange: (value: string) => void;
  onCreateSystemChange: (value: string) => void;
  onCreateTemplateChange: (value: string) => void;
  onDismissCreate: () => void;
  onFolderChange: (folder: string) => void;
  onOpenCreate: () => void;
  onOpenPrompt: (name: string) => void;
  onRetry?: () => void;
  onSearchChange: (value: string) => void;
  prompts: PromptListItem[];
  search: string;
}

export const AiPromptsListView: React.FC<AiPromptsListViewProps> = ({
  canCreate = true,
  createDescription,
  createError,
  createFolder,
  createName,
  createOpen,
  createSystem,
  createTemplate,
  folder,
  isCreating,
  isLoading,
  loadError,
  onCreate,
  onCreateDescriptionChange,
  onCreateFolderChange,
  onCreateNameChange,
  onCreateSystemChange,
  onCreateTemplateChange,
  onDismissCreate,
  onFolderChange,
  onOpenCreate,
  onOpenPrompt,
  onRetry,
  onSearchChange,
  prompts,
  search,
}) => {
  const visible = useMemo((): PromptListRow[] => {
    return filterPrompts({folder, prompts, search});
  }, [folder, prompts, search]);
  const folders = useMemo(() => {
    return folderCounts(prompts);
  }, [prompts]);
  const folderKeys = useMemo(() => {
    return [ALL_FOLDERS, ...folders.map((entry) => entry.folder)];
  }, [folders]);
  const selectedFolderIndex = Math.max(0, folderKeys.indexOf(folder));

  const handleFolderIndexChange = useCallback(
    (index: number): void => {
      onFolderChange(folderKeys[index] ?? ALL_FOLDERS);
    },
    [folderKeys, onFolderChange]
  );

  const customColumnComponentMap = useMemo(
    () => ({
      number: NumberCell,
      promptName: ({cellData}: {cellData: DataTableCellData}) => {
        const prompt = cellData.value as PromptListRow;
        return (
          <Box
            accessibilityHint="Opens the prompt editor"
            accessibilityLabel={`Open prompt ${prompt.name}`}
            flex="grow"
            gap={1}
            justifyContent="center"
            onClick={() => {
              onOpenPrompt(prompt.name);
            }}
          >
            <Box testID={`ai-prompt-open-${prompt.name}`}>
              <Text bold numberOfLines={1}>
                {prompt.name}
              </Text>
            </Box>
            <Text color="secondaryLight" numberOfLines={1} size="sm">
              {promptSubline(prompt)}
            </Text>
          </Box>
        );
      },
      promptNewest: NewestCell,
      promptProduction: ProductionCell,
      promptType: TypeBadgeCell,
    }),
    [onOpenPrompt]
  );

  const tableColumnsInput = useMemo(() => buildColumns(visible), [visible]);
  // The search box above the table already covers names, so the table adds no search.
  const {rows: _sortedPrompts, ...table} = useClientTable({
    columns: tableColumnsInput,
    rows: visible,
  });

  const renderBody = (): React.ReactNode => {
    if (isLoading) {
      return (
        <Box alignItems="center" padding={5} testID="ai-prompts-loading">
          <Spinner />
        </Box>
      );
    }
    if (loadError) {
      return null;
    }
    if (prompts.length === 0) {
      return (
        <ObservabilityEmptyState
          actionIconName="plus"
          actionText={canCreate ? "New prompt" : undefined}
          description="Create a prompt, then load it by name from your app."
          iconName="file-lines"
          onAction={canCreate ? onOpenCreate : undefined}
          testID="ai-prompts-empty"
          title="No prompts yet"
        />
      );
    }
    if (visible.length === 0) {
      return (
        <ObservabilityEmptyState
          description="Try another folder or clear the search."
          iconName="magnifying-glass"
          testID="ai-prompts-no-matches"
          title="No prompts match"
        />
      );
    }
    return (
      <DataTable
        {...table}
        customColumnComponentMap={customColumnComponentMap}
        emptyContent={
          <ObservabilityEmptyState
            description="Clear a column filter to see more prompts."
            iconName="filter"
            testID="ai-prompts-no-matches"
            title="No prompts match these filters"
          />
        }
        rowHeight={PROMPT_ROW_HEIGHT}
        testID="ai-prompts-table"
      />
    );
  };

  return (
    <Box gap={4} testID="ai-prompts-list">
      {prompts.length > 0 ? (
        <Box alignItems="end" direction="row" gap={4} justifyContent="between" wrap>
          <Box testID="ai-prompts-folders">
            <SegmentedControl
              badges={[
                {count: prompts.length, status: "neutral"},
                ...folders.map((entry) => ({count: entry.count, status: "neutral" as const})),
              ]}
              items={["All", ...folders.map((entry) => entry.folder)]}
              onChange={handleFolderIndexChange}
              selectedIndex={selectedFolderIndex}
              size="sm"
            />
          </Box>
          <Box minWidth={240} width={320}>
            <TextField
              iconName="magnifying-glass"
              onChange={onSearchChange}
              placeholder="Search by name or folder"
              testID="ai-prompts-search"
              type="search"
              value={search}
            />
          </Box>
        </Box>
      ) : null}
      {loadError ? (
        <ObservabilityErrorState
          onRetry={onRetry}
          testID="ai-prompts-load-error"
          text={loadError}
        />
      ) : null}
      {renderBody()}
      <Modal
        onDismiss={onDismissCreate}
        primaryButtonDisabled={isCreating || !createName.trim() || !createFolder.trim()}
        primaryButtonOnClick={onCreate}
        primaryButtonText="Create"
        secondaryButtonOnClick={onDismissCreate}
        secondaryButtonText="Cancel"
        title="New prompt"
        visible={createOpen}
      >
        <Box gap={3} testID="ai-prompts-create-form">
          <TextField
            onChange={onCreateFolderChange}
            testID="ai-prompts-create-folder"
            title="Folder"
            value={createFolder}
          />
          <TextField
            onChange={onCreateNameChange}
            testID="ai-prompts-create-name"
            title="Name"
            value={createName}
          />
          <TextField
            helperText="Optional. A short summary for people browsing the list."
            multiline
            onChange={onCreateDescriptionChange}
            testID="ai-prompts-create-description"
            title="Description"
            value={createDescription}
          />
          <TextField
            multiline
            onChange={onCreateSystemChange}
            testID="ai-prompts-create-system"
            title="System"
            value={createSystem}
          />
          <TextField
            helperText="Use {{variable}} placeholders. Saving creates version 1."
            multiline
            onChange={onCreateTemplateChange}
            testID="ai-prompts-create-template"
            title="User template"
            value={createTemplate}
          />
          {createError ? <Text color="error">{createError}</Text> : null}
        </Box>
      </Modal>
    </Box>
  );
};
