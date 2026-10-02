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

const COLUMNS: DataTableColumn[] = [
  {columnType: "text", title: "Name", width: 200},
  {columnType: "promptType", title: "Type", width: 90},
  {columnType: "text", infoModalText: LATEST_TOOLTIP, title: "Latest", width: 80},
  {columnType: "text", infoModalText: PRODUCTION_TOOLTIP, title: "Production", width: 110},
  {columnType: "text", title: "Last used", width: 110},
  {columnType: "text", title: "Calls 7d", width: 90},
  {columnType: "text", title: "Cost 7d", width: 90},
  {columnType: "promptOpen", title: "", width: 88},
];

const TypeBadgeCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box justifyContent="center">
    <Badge status="info" value={String(cellData.value ?? "")} />
  </Box>
);

export interface AiPromptsListViewProps {
  canCreate?: boolean;
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

  const rows: DataTableCellData[][] = useMemo(() => {
    return visible.map((prompt) => [
      {value: `${prompt.folder}/${prompt.name}`},
      {value: prompt.type},
      {value: `v${prompt.latestVersion}`},
      {value: formatProduction(prompt.production)},
      {value: formatLastUsed(prompt.usage7d)},
      {value: formatUsageCalls(prompt.usage7d)},
      {value: formatUsageCost(prompt.usage7d)},
      {value: prompt.name},
    ]);
  }, [visible]);

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
              columns={COLUMNS}
              customColumnComponentMap={customColumnComponentMap}
              data={rows}
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
          <TextField onChange={onCreateFolderChange} title="Folder" value={createFolder} />
          <TextField onChange={onCreateNameChange} title="Name" value={createName} />
          <TextField
            multiline
            onChange={onCreateSystemChange}
            title="System"
            value={createSystem}
          />
          <TextField
            helperText="Use {{variable}} placeholders. Saving creates immutable v1."
            multiline
            onChange={onCreateTemplateChange}
            title="User template"
            value={createTemplate}
          />
          {createError ? <Text color="error">{createError}</Text> : undefined}
        </Box>
      </Modal>
    </Box>
  );
};
