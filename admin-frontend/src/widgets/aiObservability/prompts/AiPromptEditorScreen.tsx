import {Box, Button, Spinner, Text} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {resolveAiRunBlockedMessage, resolveAiRunError} from "../shell/aiRunAccess";
import {resolvePromptActionPermissions} from "../shell/observabilityPermissions";
import {AiPromptHubView} from "./AiPromptHubView";
import {
  latestVersionFromDetail,
  type PlaygroundRunResult,
  type PromptDetail,
  unwrapPromptDetail,
  unwrapPromptPayload,
} from "./promptTypes";
import {useAiObservabilityPromptsApi} from "./useAiObservabilityPromptsApi";

export interface AiPromptEditorScreenWidgetProps extends AdminScreenWidgetProps {
  apiKey?: string;
  /** When true, the host is still reading a saved API key (for example from AsyncStorage). */
  apiKeyLoading?: boolean;
  /** Shown when the backend expects `x-ai-api-key` and no key is available yet. */
  playgroundApiKeyHint?: string;
}

export const AiPromptEditorScreenWidget: React.FC<AiPromptEditorScreenWidgetProps> = (props) => {
  const {apiKey, apiKeyLoading = false, playgroundApiKeyHint} = props;
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{name?: string | string[]}>();
  const nameParam = params.name;
  const name = Array.isArray(nameParam) ? nameParam[0] : nameParam;
  const {
    useCreateVersionMutation,
    useDetailQuery,
    usePlaygroundMutation,
    useSetLabelMutation,
    useStatusQuery,
  } = useAiObservabilityPromptsApi(api);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined);
  const [pinnedQueryVersion, setPinnedQueryVersion] = useState<number | undefined>(undefined);
  const [cachedDetail, setCachedDetail] = useState<
    {detail: PromptDetail; name: string} | undefined
  >(undefined);

  const detailQueryArg = useMemo(() => {
    if (!name) {
      return {name: ""};
    }
    if (pinnedQueryVersion === undefined) {
      return {name};
    }
    return {name, promptVersion: pinnedQueryVersion};
  }, [name, pinnedQueryVersion]);

  const {data, isError, isFetching, isLoading, refetch} = useDetailQuery(detailQueryArg, {
    skip: !name,
  });
  const statusQuery = useStatusQuery();
  const [createVersion, createState] = useCreateVersionMutation();
  const [setLabel, labelState] = useSetLabelMutation();
  const [runPlayground, playgroundState] = usePlaygroundMutation();

  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const detail = useMemo(() => unwrapPromptDetail(data), [data]);
  // Keep the last loaded hub when a version pin changes the RTK cache key.
  // A fresh query starts with empty `data` and `isLoading`, which would unmount the hub.
  useEffect(() => {
    if (!detail || !name) {
      return;
    }
    setCachedDetail({detail, name});
  }, [detail, name]);
  const samePromptCache = cachedDetail?.name === name ? cachedDetail : undefined;
  const visibleDetail = detail ?? samePromptCache?.detail;
  const version = selectedVersion ?? (visibleDetail ? latestVersionFromDetail(visibleDetail) : 1);

  // Pin GET detail to latest promptVersion after bootstrap so relationship tabs filter server-side.
  useEffect(() => {
    if (pinnedQueryVersion !== undefined || selectedVersion !== undefined) {
      return;
    }
    if (!detail) {
      return;
    }
    setPinnedQueryVersion(latestVersionFromDetail(detail));
  }, [detail, pinnedQueryVersion, selectedVersion]);

  const handleSelectVersion = useCallback((nextVersion: number): void => {
    setSelectedVersion(nextVersion);
    setPinnedQueryVersion(nextVersion);
  }, []);
  const backHref = `${prefix}/ai-prompts`;

  const handleSaveVersion = useCallback(
    async (body: {
      config?: Record<string, unknown>;
      system?: string;
      template: string;
      type: "chat" | "text";
      variables?: Array<{key: string; required: boolean}>;
    }): Promise<void> => {
      if (!name) {
        return;
      }
      const updated = await createVersion({body, name}).unwrap();
      setSelectedVersion(updated.version);
      setPinnedQueryVersion(updated.version);
    },
    [createVersion, name]
  );

  const handleSetProduction = useCallback(
    async (nextVersion: number): Promise<void> => {
      if (!name) {
        return;
      }
      await setLabel({label: "production", name, version: nextVersion}).unwrap();
    },
    [name, setLabel]
  );

  const observabilityStatus = useMemo(
    () => unwrapObservabilityStatus(statusQuery.data),
    [statusQuery.data]
  );
  const promptPermissions = useMemo(
    () =>
      resolvePromptActionPermissions({
        status: observabilityStatus,
        statusError: statusQuery.isError,
        statusLoading: statusQuery.isLoading,
      }),
    [observabilityStatus, statusQuery.isError, statusQuery.isLoading]
  );
  const playgroundAiSource = observabilityStatus?.playgroundAi?.source;
  const isPlaygroundAccessLoading = apiKeyLoading || statusQuery.isLoading;
  const playgroundBlockedMessage = useMemo(
    () =>
      resolveAiRunBlockedMessage({
        apiKey,
        apiKeyHint: playgroundApiKeyHint,
        apiKeyLoading: isPlaygroundAccessLoading,
        playgroundAiSource,
      }),
    [apiKey, isPlaygroundAccessLoading, playgroundAiSource, playgroundApiKeyHint]
  );

  const handleRunPlayground = useCallback(
    async (variables: Record<string, string>): Promise<void> => {
      if (!name || playgroundBlockedMessage) {
        return;
      }
      await runPlayground({apiKey, name, variables, version}).unwrap();
    },
    [apiKey, name, playgroundBlockedMessage, runPlayground, version]
  );

  const playgroundResult = unwrapPromptPayload<PlaygroundRunResult>(playgroundState.data);
  const playgroundError = playgroundState.isError
    ? resolveAiRunError({
        apiKey,
        apiKeyHint: playgroundApiKeyHint,
        error: playgroundState.error,
        playgroundAiSource,
      })
    : undefined;

  const isInitialLoad = isLoading && !visibleDetail;
  const isRelationshipsLoading = Boolean(visibleDetail && (isFetching || (isLoading && !detail)));
  const relationshipsError =
    isError && visibleDetail ? "Could not refresh related traces and experiments." : undefined;
  const isFatalLoadError = isError && !visibleDetail;

  if (!name) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-prompt-editor">
        <Box padding={4}>
          <Text>Missing prompt name. Open a prompt from the list.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isInitialLoad) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-prompt-editor">
        <Box alignItems="center" padding={4} testID="ai-prompt-editor-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isFatalLoadError || !visibleDetail) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-prompt-editor">
        <Box gap={2} padding={4}>
          <Text color="error">{`Could not load ${name}.`}</Text>
          <Button onClick={() => refetch()} text="Retry" />
        </Box>
      </AiObservabilityChrome>
    );
  }

  return (
    <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-prompt-editor">
      <AiPromptHubView
        detail={visibleDetail}
        isApiKeyLoading={isPlaygroundAccessLoading}
        isRelationshipsLoading={isRelationshipsLoading}
        isRunningPlayground={playgroundState.isLoading}
        isSaving={createState.isLoading}
        isSettingProduction={labelState.isLoading}
        onOpenExperiment={(experimentId) => {
          router.push(`${prefix}/ai-experiment-results?id=${encodeURIComponent(experimentId)}`);
        }}
        onOpenTrace={(traceId) => {
          router.push(`${prefix}/ai-trace-detail?id=${encodeURIComponent(traceId)}`);
        }}
        onRunPlayground={handleRunPlayground}
        onSaveVersion={handleSaveVersion}
        onSelectVersion={handleSelectVersion}
        onSetProduction={handleSetProduction}
        permissions={promptPermissions}
        playgroundBlockedMessage={playgroundBlockedMessage}
        playgroundError={playgroundError}
        playgroundResult={playgroundResult}
        productionError={labelState.isError ? "Could not set production." : undefined}
        relationshipsError={relationshipsError}
        saveError={createState.isError ? "Could not save a new version." : undefined}
        selectedVersion={version}
      />
    </AiObservabilityChrome>
  );
};
