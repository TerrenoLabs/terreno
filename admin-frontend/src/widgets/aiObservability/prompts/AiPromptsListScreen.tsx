import {Box, Spinner} from "@terreno/ui";
import {router} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {resolvePromptActionPermissions} from "../shell/observabilityPermissions";
import {AiPromptsListView} from "./AiPromptsListView";
import {
  ALL_FOLDERS,
  templateVariableKeys,
  unwrapPromptList,
  variablesFromKeys,
} from "./promptTypes";
import {useAiObservabilityPromptsApi} from "./useAiObservabilityPromptsApi";

export const AiPromptsScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useCreateMutation, useListQuery, useStatusQuery} = useAiObservabilityPromptsApi(api);
  const {data, error, isError, isLoading, refetch} = useListQuery({include: "usage7d"});
  const statusQuery = useStatusQuery();
  const [createPrompt, createState] = useCreateMutation();
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState(ALL_FOLDERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFolder, setCreateFolder] = useState("examples");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createSystem, setCreateSystem] = useState("");
  const [createTemplate, setCreateTemplate] = useState("");
  const [createError, setCreateError] = useState("");

  const prompts = useMemo(() => unwrapPromptList(data), [data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const canCreatePrompt = useMemo(() => {
    return resolvePromptActionPermissions({
      status: unwrapObservabilityStatus(statusQuery.data),
      statusError: statusQuery.isError,
      statusLoading: statusQuery.isLoading,
    }).canCreate;
  }, [statusQuery.data, statusQuery.isError, statusQuery.isLoading]);

  const handleOpen = useCallback(
    (name: string): void => {
      router.push(`${prefix}/ai-prompt-editor?name=${encodeURIComponent(name)}`);
    },
    [prefix]
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    setCreateError("");
    try {
      const trimmedDescription = createDescription.trim();
      const created = await createPrompt({
        folder: createFolder.trim(),
        name: createName.trim(),
        ...(trimmedDescription ? {description: trimmedDescription} : {}),
        system: createSystem,
        template: createTemplate,
        type: "chat",
        variables: variablesFromKeys(templateVariableKeys(createTemplate)),
      }).unwrap();
      setCreateOpen(false);
      router.push(`${prefix}/ai-prompt-editor?name=${encodeURIComponent(created.name)}`);
    } catch {
      setCreateError("Could not create prompt. Check the name is unique and try again.");
    }
  }, [
    createDescription,
    createFolder,
    createName,
    createPrompt,
    createSystem,
    createTemplate,
    prefix,
  ]);

  const loadError = isError
    ? error && typeof error === "object" && "data" in error
      ? "Failed to load prompts"
      : "Failed to load prompts"
    : undefined;

  return (
    <AiObservabilityChrome {...props} screenName="ai-prompts">
      {isLoading ? (
        <Box alignItems="center" padding={4} testID="ai-prompts-loading">
          <Spinner />
        </Box>
      ) : (
        <AiPromptsListView
          canCreate={canCreatePrompt}
          createDescription={createDescription}
          createError={createError}
          createFolder={createFolder}
          createName={createName}
          createOpen={createOpen}
          createSystem={createSystem}
          createTemplate={createTemplate}
          folder={folder}
          isCreating={createState.isLoading}
          loadError={loadError}
          onCreate={handleCreate}
          onCreateDescriptionChange={setCreateDescription}
          onCreateFolderChange={setCreateFolder}
          onCreateNameChange={setCreateName}
          onCreateSystemChange={setCreateSystem}
          onCreateTemplateChange={setCreateTemplate}
          onDismissCreate={() => {
            setCreateOpen(false);
          }}
          onFolderChange={setFolder}
          onOpenCreate={() => {
            setCreateOpen(true);
          }}
          onOpenPrompt={handleOpen}
          onRetry={refetch}
          onSearchChange={setSearch}
          prompts={prompts}
          search={search}
        />
      )}
    </AiObservabilityChrome>
  );
};
