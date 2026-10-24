import {
  Badge,
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  Heading,
  Modal,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import React, {useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {
  ALL_FOLDERS,
  filterPrompts,
  folderCounts,
  formatLastUsed,
  formatProduction,
  formatUsageCalls,
  formatUsageCost,
  type PromptListItem,
} from "./promptTypes";

const LATEST_TOOLTIP =
  "Latest is the highest immutable version number. It is not necessarily the version apps call.";
const PRODUCTION_TOOLTIP =
  "Production is the labelled version apps resolve with promptLabel production. — means no production label yet.";

/** Header tooltips by column index; `useClientTable` columns do not carry `infoModalText`. */
const COLUMN_INFO: Record<number, string> = {2: LATEST_TOOLTIP, 3: PRODUCTION_TOOLTIP};

const productionVersion = (prompt: PromptListItem): number | undefined => {
  return prompt.production === "—" ? undefined : prompt.production;
};

const buildColumns = (prompts: PromptListItem[]): ClientTableColumn<PromptListItem>[] => [
  {
    filter: {kind: "text"},
    key: "name",
    title: "Name",
    value: (prompt) => `${prompt.folder}/${prompt.name}`,
    width: 220,
  },
  {
    columnType: "promptType",
    filter: {kind: "choice", options: distinctChoiceOptions(prompts, (prompt) => prompt.type)},
    key: "type",
    title: "Type",
    value: (prompt) => prompt.type,
    width: 130,
  },
  {
    // Title, filter, info, and sort icons plus padding keep "v12" and the header on one line.
    cell: (prompt) => ({value: `v${prompt.latestVersion}`}),
    filter: {kind: "numberRange"},
    key: "latest",
    title: "Latest",
    value: (prompt) => prompt.latestVersion,
    width: 160,
  },
  {
    cell: (prompt) => ({value: formatProduction(prompt.production)}),
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
    width: 190,
  },
  {
    cell: (prompt) => ({value: formatLastUsed(prompt.usage7d)}),
    filter: {kind: "dateRange"},
    key: "lastUsed",
    title: "Last used",
    value: (prompt) => prompt.usage7d?.lastUsed,
    width: 160,
  },
  {
    cell: (prompt) => ({value: formatUsageCalls(prompt.usage7d)}),
    filter: {kind: "numberRange"},
    key: "calls7d",
    title: "Calls 7d",
    value: (prompt) => prompt.usage7d?.calls,
    width: 150,
  },
  {
    cell: (prompt) => ({value: formatUsageCost(prompt.usage7d)}),
    filter: {kind: "numberRange"},
    key: "cost7d",
    title: "Cost 7d",
    value: (prompt) => prompt.usage7d?.costUsd,
    width: 150,
  },
  {
    cell: (prompt) => ({value: prompt.name}),
    columnType: "promptOpen",
    key: "open",
    title: "",
    width: 88,
  },
];

const TypeBadgeCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box justifyContent="center">
    <Badge status="info" value={String(cellData.value ?? "")} />
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
  const visible = useMemo(() => {
    return filterPrompts({folder, prompts, search});
  }, [folder, prompts, search]);
  const folders = useMemo(() => {
    return folderCounts(prompts);
  }, [prompts]);

  const customColumnComponentMap = useMemo(
    () => ({
      promptOpen: ({cellData}: {cellData: DataTableCellData}) => (
        <Box justifyContent="center">
          <Button
            onClick={() => {
              onOpenPrompt(String(cellData.value ?? ""));
            }}
            size="sm"
            testID={`ai-prompt-open-${String(cellData.value ?? "")}`}
            text="Open"
            variant="outline"
          />
        </Box>
      ),
      promptType: TypeBadgeCell,
    }),
    [onOpenPrompt]
  );

  const tableColumnsInput = useMemo(() => buildColumns(visible), [visible]);
  // The library search box above the table already covers names, so the table adds no search.
  const {rows: _sortedPrompts, ...table} = useClientTable({
    columns: tableColumnsInput,
    rows: visible,
  });
  const columns: DataTableColumn[] = useMemo(() => {
    return table.columns.map((column, index) => {
      const infoModalText = COLUMN_INFO[index];
      return infoModalText ? {...column, infoModalText} : column;
    });
  }, [table.columns]);

  return (
    <Box gap={3} testID="ai-prompts-list">
      <Box direction="row" gap={4} minHeight={400} wrap>
        <Box gap={2} testID="ai-prompts-folder-rail" width={200}>
          <Heading size="sm">Folders</Heading>
          <Button
            onClick={() => {
              onFolderChange(ALL_FOLDERS);
            }}
            testID="ai-prompts-folder-all"
            text={`All (${prompts.length})`}
            variant={folder === ALL_FOLDERS ? "primary" : "ghost"}
          />
          {folders.map((entry) => (
            <Button
              key={entry.folder}
              onClick={() => {
                onFolderChange(entry.folder);
              }}
              testID={`ai-prompts-folder-${entry.folder}`}
              text={`${entry.folder} (${entry.count})`}
              variant={folder === entry.folder ? "primary" : "ghost"}
            />
          ))}
        </Box>
        <Box flex="grow" gap={3} minWidth={0}>
          <Box direction="row" gap={2} justifyContent="between" wrap>
            <Box flex="grow">
              <TextField
                onChange={onSearchChange}
                placeholder="Search name or folder"
                testID="ai-prompts-search"
                title="Search"
                value={search}
              />
            </Box>
            {canCreate ? (
              <Button onClick={onOpenCreate} testID="ai-prompts-create" text="Create prompt" />
            ) : undefined}
          </Box>
          {loadError ? (
            <Box gap={2} testID="ai-prompts-load-error">
              <Text color="error">{loadError}</Text>
              {onRetry ? <Button onClick={onRetry} text="Retry" /> : undefined}
            </Box>
          ) : undefined}
          {isLoading ? (
            <Box alignItems="center" padding={6} testID="ai-prompts-loading">
              <Spinner />
            </Box>
          ) : visible.length === 0 ? (
            <Box padding={4} testID="ai-prompts-empty">
              <Text color="secondaryDark">No prompts in this folder yet.</Text>
            </Box>
          ) : (
            <DataTable
              {...table}
              columns={columns}
              customColumnComponentMap={customColumnComponentMap}
              emptyContent={
                <Box padding={4} testID="ai-prompts-no-matches">
                  <Text color="secondaryDark">No prompts match these filters.</Text>
                </Box>
              }
              testID="ai-prompts-table"
            />
          )}
        </Box>
      </Box>
      <Modal
        onDismiss={onDismissCreate}
        primaryButtonDisabled={isCreating || !createName.trim() || !createFolder.trim()}
        primaryButtonOnClick={onCreate}
        primaryButtonText="Create"
        secondaryButtonOnClick={onDismissCreate}
        secondaryButtonText="Cancel"
        title="Create prompt"
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
            helperText="Optional short summary for operators browsing the library."
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
            helperText="Use {{variable}} placeholders. Saving creates immutable v1."
            multiline
            onChange={onCreateTemplateChange}
            testID="ai-prompts-create-template"
            title="User template"
            value={createTemplate}
          />
          {createError ? <Text color="error">{createError}</Text> : undefined}
        </Box>
      </Modal>
    </Box>
  );
};
