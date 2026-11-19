import {
  Badge,
  Box,
  DataTable,
  type DataTableCellData,
  Icon,
  Modal,
  SelectField,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {
  ALL_FOLDERS,
  childFolders,
  filterPrompts,
  formatFolderPath,
  type PromptListItem,
  pathSegments,
  promptLocation,
  promptTags,
} from "./promptTypes";

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
  const directory = formatFolderPath(promptLocation(prompt).directory);
  if (prompt.description && directory) {
    return `${directory} · ${prompt.description}`;
  }
  if (prompt.description) {
    return prompt.description;
  }
  return directory || prompt.folder;
};

interface FolderRowCell {
  count: number;
  kind: "folder";
  name: string;
  path: string;
}

interface UpRowCell {
  kind: "up";
  label: string;
  path: string;
}

type NavigationCell = FolderRowCell | UpRowCell;

const isNavigationCell = (value: unknown): value is NavigationCell => {
  if (!value || typeof value !== "object" || !("kind" in value)) {
    return false;
  }
  const kind = (value as {kind?: unknown}).kind;
  return kind === "folder" || kind === "up";
};

const promptCountLabel = (count: number): string => {
  return `${count} ${count === 1 ? "prompt" : "prompts"}`;
};

const FolderNameCell: React.FC<{
  cell: NavigationCell;
  onOpen: (path: string) => void;
}> = ({cell, onOpen}) => {
  const handlePress = useCallback((): void => {
    onOpen(cell.path);
  }, [cell.path, onOpen]);

  const isUp = cell.kind === "up";
  const detail = isUp ? "Up one folder" : promptCountLabel(cell.count);
  const testID = isUp ? "ai-prompts-folder-up" : `ai-prompts-folder-${cell.path}`;

  return (
    <Box
      accessibilityHint={isUp ? "Goes up one folder" : "Shows the prompts in this folder"}
      accessibilityLabel={isUp ? `Up to ${cell.label}` : `Open folder ${cell.name}, ${detail}`}
      accessibilityRole="button"
      alignItems="center"
      direction="row"
      flex="grow"
      minWidth={0}
      onClick={handlePress}
      overflow="hidden"
      testID={testID}
    >
      <Box flex="none" marginRight={3}>
        <Icon color="secondaryDark" iconName={isUp ? "arrow-left" : "folder"} size="sm" />
      </Box>
      <Box flex="shrink" gap={1} minWidth={0} overflow="hidden">
        <Text bold numberOfLines={1}>
          {isUp ? cell.label : cell.name}
        </Text>
        <Text color="secondaryLight" numberOfLines={1} size="sm">
          {detail}
        </Text>
      </Box>
    </Box>
  );
};

const DashCell: React.FC = () => (
  <Box justifyContent="center">
    <Text color="secondaryLight">—</Text>
  </Box>
);

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
  if (!PROMPT_TYPE_LABELS[type]) {
    return <DashCell />;
  }
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
    return <DashCell />;
  }
  return (
    <Box alignItems="start" justifyContent="center">
      <Badge secondary status="success" value={`v${cellData.value}`} />
    </Box>
  );
};

const NewestCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const prompt = cellData.value as PromptListRow;
  if (!prompt || typeof prompt !== "object" || !("latestVersion" in prompt)) {
    return <DashCell />;
  }
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
  onTagChange: (tag: string) => void;
  prompts: PromptListItem[];
  search: string;
  tag: string;
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
  onTagChange,
  prompts,
  search,
  tag,
}) => {
  const currentDirectory = useMemo(() => pathSegments(folder).join("/"), [folder]);
  const browsing = search.trim().length === 0 && tag.trim().length === 0;
  const visible = useMemo((): PromptListRow[] => {
    if (!browsing) {
      return filterPrompts({folder: ALL_FOLDERS, prompts, search, tag});
    }
    return prompts.filter((prompt) => promptLocation(prompt).directory === currentDirectory);
  }, [browsing, currentDirectory, prompts, search, tag]);
  const foldersHere = useMemo(() => {
    if (!browsing) {
      return [];
    }
    return childFolders(prompts, currentDirectory);
  }, [browsing, currentDirectory, prompts]);
  const upRow = useMemo((): UpRowCell | undefined => {
    const segments = pathSegments(currentDirectory);
    if (!browsing || segments.length === 0) {
      return undefined;
    }
    const parentSegments = segments.slice(0, -1);
    return {
      kind: "up",
      label:
        parentSegments.length === 0
          ? "All prompts"
          : (parentSegments[parentSegments.length - 1] ?? "All prompts"),
      path: parentSegments.join("/"),
    };
  }, [browsing, currentDirectory]);
  const tags = useMemo(() => promptTags(prompts), [prompts]);

  const customColumnComponentMap = useMemo(
    () => ({
      number: NumberCell,
      promptName: ({cellData}: {cellData: DataTableCellData}) => {
        if (isNavigationCell(cellData.value)) {
          return <FolderNameCell cell={cellData.value} onOpen={onFolderChange} />;
        }
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
                {promptLocation(prompt).leaf}
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
    [onFolderChange, onOpenPrompt]
  );

  const navigationRows = useMemo((): DataTableCellData[][] => {
    const blank = {value: "—"};
    const rest = [blank, blank, blank, blank, blank];
    const rows: DataTableCellData[][] = [];
    if (upRow) {
      rows.push([{value: upRow}, ...rest]);
    }
    for (const entry of foldersHere) {
      rows.push([
        {
          value: {count: entry.count, kind: "folder", name: entry.name, path: entry.path},
        },
        ...rest,
      ]);
    }
    return rows;
  }, [foldersHere, upRow]);

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
    if (visible.length === 0 && navigationRows.length === 0) {
      return (
        <ObservabilityEmptyState
          description="Try another tag, or clear the search."
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
        data={[...navigationRows, ...table.data]}
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
        <Box alignItems="end" direction="row" gap={4} justifyContent="end" wrap>
          {tags.length > 0 ? (
            <Box minWidth={200} width={240}>
              <SelectField
                onChange={onTagChange}
                options={tags.map((entry) => ({label: entry, value: entry}))}
                placeholder="All tags"
                testID="ai-prompts-tag"
                title="Tag"
                value={tag}
              />
            </Box>
          ) : null}
          <Box minWidth={240} width={320}>
            <TextField
              iconName="magnifying-glass"
              onChange={onSearchChange}
              placeholder="Search by name, folder, or tag"
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
            helperText="Use a slash for each nested folder, such as appointmentAI/intake."
            onChange={onCreateFolderChange}
            testID="ai-prompts-create-folder"
            title="Folder"
            value={createFolder}
          />
          <TextField
            helperText="A slash nests the name too. The last segment is the prompt."
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
